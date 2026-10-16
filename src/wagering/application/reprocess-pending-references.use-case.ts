import type { TransactionContext, TransactionRunner } from '../../database/transaction-runner';
import type { OutboxRepository } from '../../messaging/application/ports/outbox.repository';
import { WagerProcessedEvent } from '../../messaging/domain/events/wager-processed.event';
import { WagerRejectedEvent } from '../../messaging/domain/events/wager-rejected.event';
import type { IntegrationEvent } from '../../messaging/domain/integration-event';
import type { IdGenerator } from '../../shared/application/id-generator';
import type { WalletRepository } from '../../wallet/application/ports/wallet.repository';
import { LedgerDirection, WalletLedgerEntry } from '../../wallet/domain/wallet-ledger-entry';
import { WalletBalanceChangedEvent } from '../../messaging/domain/events/wallet-balance-changed.event';
import { evaluateWager } from '../domain/wager-rules';
import {
  WagerTransactionStatus,
  type PendingReferenceRetryPolicy,
  type WagerTransaction,
} from '../domain/wager-transaction';
import type { WagerTransactionRepository } from './ports/wager-transaction.repository';

export interface PendingReferenceOptions extends PendingReferenceRetryPolicy {
  leaseMs: number;
}

export interface ReprocessPendingReferencesResult {
  claimed: number;
  processed: number;
  rejected: number;
  rescheduled: number;
}

export class ReprocessPendingReferencesUseCase {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly wallets: WalletRepository,
    private readonly wagers: WagerTransactionRepository,
    private readonly outbox: OutboxRepository,
    private readonly ids: IdGenerator,
    private readonly options: PendingReferenceOptions,
  ) {}

  async execute(now: Date, batchSize: number): Promise<ReprocessPendingReferencesResult> {
    const claimed = await this.transactions.run((context) =>
      this.wagers.claimDuePending(
        now,
        batchSize,
        new Date(now.getTime() + this.options.leaseMs),
        context,
      ),
    );
    const result = { claimed: claimed.length, processed: 0, rejected: 0, rescheduled: 0 };
    for (const claim of claimed) {
      const outcome = await this.transactions.run((context) => this.reprocessOne(claim.id, now, context));
      result[outcome] += 1;
    }
    return result;
  }

  private async reprocessOne(
    transactionId: string,
    now: Date,
    context: TransactionContext,
  ): Promise<'processed' | 'rejected' | 'rescheduled'> {
    const transaction = await this.wagers.findById(transactionId, context);
    if (transaction === null || transaction.status !== WagerTransactionStatus.PendingReference) {
      return 'rescheduled';
    }
    const wallet = await this.wallets.findOneForUpdate(transaction.walletId, context);
    if (wallet === null) throw new Error(`Wallet ${transaction.walletId} was not found`);
    const reference = transaction.referenceExternalTransactionId === undefined
      ? undefined
      : await this.wagers.findByProviderExternal(
          transaction.providerId,
          transaction.referenceExternalTransactionId,
          context,
        ) ?? undefined;
    const reversals = reference === undefined
      ? []
      : await this.wagers.findProcessedReversals(reference.id, context);
    const decision = evaluateWager(transaction, wallet, reference, reversals);

    if (decision.type === 'PENDING_REFERENCE') {
      transaction.scheduleReferenceRetry(now, this.options);
      if (transaction.isTerminal()) {
        await this.enqueueRejected(transaction, wallet.balance.toJSON(), now, context);
        await this.wagers.save(transaction, context);
        return 'rejected';
      }
      await this.wagers.save(transaction, context);
      return 'rescheduled';
    }

    if (decision.type === 'REJECT') {
      transaction.reject(decision.failureCode, wallet.balance);
      await this.enqueueRejected(transaction, wallet.balance.toJSON(), now, context);
      await this.wagers.save(transaction, context);
      return 'rejected';
    }

    let change: ReturnType<typeof wallet.credit> | undefined;
    if (decision.direction !== undefined) {
      change = decision.direction === LedgerDirection.Debit
        ? wallet.debit(transaction.money, now)
        : wallet.credit(transaction.money, now);
      await this.wallets.appendLedger(WalletLedgerEntry.create({
        id: this.ids.next(),
        walletId: wallet.id,
        transactionId: transaction.id,
        direction: decision.direction,
        money: transaction.money,
        balanceBefore: change.balanceBefore,
        balanceAfter: change.balanceAfter,
        createdAt: now,
      }), context);
      await this.wallets.save(wallet, context);
    }
    transaction.markProcessed(decision.referenceTransactionId, now, wallet.balance);
    await this.enqueue(new WagerProcessedEvent({
      ...this.metadata(transaction.idempotencyKey, transaction.id, now),
      transactionId: transaction.id,
      walletId: wallet.id,
      providerId: transaction.providerId,
      status: transaction.status,
      balance: wallet.balance.toJSON(),
    }), wallet.id, context);
    if (change !== undefined && !change.balanceBefore.equals(change.balanceAfter)) {
      await this.enqueue(new WalletBalanceChangedEvent({
        ...this.metadata(transaction.idempotencyKey, transaction.id, now),
        transactionId: transaction.id,
        walletId: wallet.id,
        balanceBefore: change.balanceBefore.toJSON(),
        balanceAfter: change.balanceAfter.toJSON(),
        walletVersion: change.version,
      }), wallet.id, context);
    }
    await this.wagers.save(transaction, context);
    return 'processed';
  }

  private enqueueRejected(transaction: WagerTransaction, balance: { amount: string; currency: string }, now: Date, context: TransactionContext): Promise<void> {
    const event = new WagerRejectedEvent({
      ...this.metadata(transaction.idempotencyKey, transaction.id, now),
      transactionId: transaction.id,
      walletId: transaction.walletId,
      providerId: transaction.providerId,
      failureCode: transaction.failureCode!,
      balance,
    });
    return this.enqueue(event, transaction.walletId, context);
  }

  private metadata(correlationId: string, causationId: string, occurredAt: Date) {
    return { id: this.ids.next(), occurredAt, correlationId, causationId };
  }

  private enqueue(
    event: IntegrationEvent<Record<string, unknown>>,
    aggregateId: string,
    context: TransactionContext,
  ): Promise<void> {
    const payload = event.toJSON();
    return this.outbox.insert({
      id: event.id,
      aggregateId,
      eventType: payload.type,
      payload,
      occurredAt: event.occurredAt,
      attempts: 0,
      nextAttemptAt: undefined,
      publishedAt: undefined,
    }, context);
  }
}
