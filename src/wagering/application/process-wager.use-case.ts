import type { TransactionContext, TransactionRunner } from '../../database/transaction-runner';
import { ApplicationError } from '../../shared/application/application.error';
import { hashBusinessPayload } from '../../shared/application/canonical-json';
import type { Clock } from '../../shared/application/clock';
import type { IdGenerator } from '../../shared/application/id-generator';
import type { Money, MoneyProps } from '../../shared/domain/money/money';
import type { OutboxRepository } from '../../messaging/application/ports/outbox.repository';
import type { IntegrationEvent } from '../../messaging/domain/integration-event';
import { WagerPendingReferenceEvent } from '../../messaging/domain/events/wager-pending-reference.event';
import { WagerProcessedEvent } from '../../messaging/domain/events/wager-processed.event';
import { WagerRejectedEvent } from '../../messaging/domain/events/wager-rejected.event';
import { WalletBalanceChangedEvent } from '../../messaging/domain/events/wallet-balance-changed.event';
import type { WalletRepository } from '../../wallet/application/ports/wallet.repository';
import { LedgerDirection, WalletLedgerEntry } from '../../wallet/domain/wallet-ledger-entry';
import { evaluateWager } from '../domain/wager-rules';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../domain/wager-transaction';
import type { WagerTransactionRepository } from './ports/wager-transaction.repository';
import type { OperationalMetrics } from '../../shared/observability/metrics';
import type { StructuredLogger } from '../../shared/observability/logger';

export interface ProcessWagerCommand {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId: string | undefined;
}

export interface ProcessWagerResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps;
  idempotentReplay: boolean;
  failureCode?: string;
}

export class ProcessWagerUseCase {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly wallets: WalletRepository,
    private readonly wagers: WagerTransactionRepository,
    private readonly outbox: OutboxRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly metrics?: OperationalMetrics,
    private readonly logger?: StructuredLogger,
  ) {}

  async execute(command: ProcessWagerCommand, context?: TransactionContext): Promise<ProcessWagerResult> {
    const startedAt = Date.now();
    const payloadHash = this.payloadHash(command);

    if (context !== undefined) {
      const result = await this.executeInContext(command, payloadHash, context);
      this.record(command, result, startedAt);
      return result;
    }

    try {
      const result = await this.transactions.run((transactionContext) =>
        this.executeInContext(command, payloadHash, transactionContext),
      );
      this.record(command, result, startedAt);
      return result;
    } catch (error) {
      const existing = await this.wagers.findByIdempotencyKey(command.idempotencyKey);
      if (existing !== null) {
        const result = this.replay(existing, payloadHash);
        this.record(command, result, startedAt);
        return result;
      }
      throw error;
    }
  }

  private async executeInContext(
    command: ProcessWagerCommand,
    payloadHash: string,
    context: TransactionContext,
  ): Promise<ProcessWagerResult> {
        const existing = await this.wagers.findByIdempotencyKey(command.idempotencyKey, context);
        if (existing !== null) return this.replay(existing, payloadHash);

        const lockStartedAt = Date.now();
        const wallet = await this.wallets.findOneForUpdate(command.walletId, context);
        this.metrics?.observe('wallet_lock_wait_ms', Date.now() - lockStartedAt);
        if (wallet === null) {
          throw new ApplicationError('WALLET_NOT_FOUND', `Wallet ${command.walletId} was not found`);
        }

        const now = this.clock.now();
        const transaction = WagerTransaction.create({ ...command, id: this.ids.next(), payloadHash, createdAt: now });
        const reference = command.referenceExternalTransactionId === undefined
          ? undefined
          : await this.wagers.findByProviderExternal(
              command.providerId,
              command.referenceExternalTransactionId,
              context,
            ) ?? undefined;
        const reversals = reference === undefined
          ? []
          : await this.wagers.findProcessedReversals(reference.id, context);
        const decision = evaluateWager(transaction, wallet, reference, reversals);

        if (decision.type === 'PENDING_REFERENCE') {
          transaction.markPendingReference(wallet.balance);
          await this.enqueue(new WagerPendingReferenceEvent({
            ...this.eventMetadata(command, transaction.id, wallet.id, now),
            transactionId: transaction.id, walletId: wallet.id, providerId: command.providerId,
            referenceExternalTransactionId: command.referenceExternalTransactionId!, balance: wallet.balance.toJSON(),
          }), wallet.id, context);
        } else if (decision.type === 'REJECT') {
          transaction.reject(decision.failureCode, wallet.balance);
          await this.enqueue(new WagerRejectedEvent({
            ...this.eventMetadata(command, transaction.id, wallet.id, now),
            transactionId: transaction.id, walletId: wallet.id, providerId: command.providerId,
            failureCode: decision.failureCode, balance: wallet.balance.toJSON(),
          }), wallet.id, context);
        } else {
          let balanceChange: { balanceBefore: Money; balanceAfter: Money; version: number } | undefined;
          if (decision.direction !== undefined) {
            const change = decision.direction === LedgerDirection.Debit
              ? wallet.debit(command.money, now)
              : wallet.credit(command.money, now);
            balanceChange = change;
            await this.wallets.appendLedger(
              WalletLedgerEntry.create({
                id: this.ids.next(),
                walletId: wallet.id,
                transactionId: transaction.id,
                direction: decision.direction,
                money: command.money,
                balanceBefore: change.balanceBefore,
                balanceAfter: change.balanceAfter,
                createdAt: now,
              }),
              context,
            );
            await this.wallets.save(wallet, context);
          }
          transaction.markProcessed(decision.referenceTransactionId, now, wallet.balance);
          await this.enqueue(new WagerProcessedEvent({
            ...this.eventMetadata(command, transaction.id, wallet.id, now),
            transactionId: transaction.id, walletId: wallet.id, providerId: command.providerId,
            status: transaction.status, balance: wallet.balance.toJSON(),
          }), wallet.id, context);
          if (balanceChange !== undefined && !balanceChange.balanceBefore.equals(balanceChange.balanceAfter)) {
            await this.enqueue(new WalletBalanceChangedEvent({
              ...this.eventMetadata(command, transaction.id, wallet.id, now),
              transactionId: transaction.id, walletId: wallet.id,
              balanceBefore: balanceChange.balanceBefore.toJSON(), balanceAfter: balanceChange.balanceAfter.toJSON(),
              walletVersion: balanceChange.version,
            }), wallet.id, context);
          }
        }

        await this.wagers.save(transaction, context);
        return this.result(transaction, wallet.balance.toJSON(), false);
  }

  private replay(transaction: WagerTransaction, payloadHash: string): ProcessWagerResult {
    if (!transaction.matchesPayload(payloadHash)) {
      throw new ApplicationError('IDEMPOTENCY_CONFLICT', 'The key was already used with another payload');
    }
    if (transaction.resultBalance === undefined) {
      throw new ApplicationError('MISSING_RESULT_BALANCE', 'Stored transaction has no balance snapshot');
    }
    this.metrics?.increment('wager_duplicates_total');
    return this.result(transaction, transaction.resultBalance.toJSON(), true);
  }

  private record(command: ProcessWagerCommand, result: ProcessWagerResult, startedAt: number): void {
    this.metrics?.increment('wager_transactions_total', { status: result.status, kind: command.kind });
    this.metrics?.observe('wager_processing_latency_ms', Date.now() - startedAt, { kind: command.kind });
    this.logger?.info('wager transaction completed', {
      correlationId: command.idempotencyKey,
      transactionId: result.transactionId,
      walletId: command.walletId,
      providerId: command.providerId,
      status: result.status,
      kind: command.kind,
      idempotentReplay: result.idempotentReplay,
    });
  }

  private result(
    transaction: WagerTransaction,
    balance: MoneyProps,
    idempotentReplay: boolean,
  ): ProcessWagerResult {
    return {
      transactionId: transaction.id,
      status: transaction.status,
      balance,
      idempotentReplay,
      ...(transaction.failureCode === undefined ? {} : { failureCode: transaction.failureCode }),
    };
  }

  private payloadHash(command: ProcessWagerCommand): string {
    return hashBusinessPayload({
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      playerId: command.playerId,
      walletId: command.walletId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: command.money.toJSON(),
      referenceExternalTransactionId: command.referenceExternalTransactionId,
    });
  }

  private eventMetadata(command: ProcessWagerCommand, causationId: string, aggregateId: string, occurredAt: Date) {
    return { id: this.ids.next(), aggregateId, occurredAt, correlationId: command.idempotencyKey, causationId };
  }

  private enqueue(
    event: IntegrationEvent<Record<string, unknown>>,
    aggregateId: string,
    context: import('../../database/transaction-runner').TransactionContext,
  ): Promise<void> {
    const payload = event.toJSON();
    return this.outbox.insert({
      id: event.id, aggregateId, eventType: payload.eventType, payload,
      occurredAt: event.occurredAt, attempts: 0, nextAttemptAt: undefined, publishedAt: undefined,
    }, context);
  }
}
