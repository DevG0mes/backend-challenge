import type { TransactionRunner } from '../../database/transaction-runner';
import { hashBusinessPayload } from '../../shared/application/canonical-json';
import type { Clock } from '../../shared/application/clock';
import type { IdGenerator } from '../../shared/application/id-generator';
import { Money, type MoneyProps } from '../../shared/domain/money/money';
import type { WagerTransactionRepository } from '../../wagering/application/ports/wager-transaction.repository';
import type { OutboxRepository } from '../../messaging/application/ports/outbox.repository';
import { WagerProcessedEvent } from '../../messaging/domain/events/wager-processed.event';
import { WalletBalanceChangedEvent } from '../../messaging/domain/events/wallet-balance-changed.event';
import {
  WagerTransaction,
  WagerTransactionKind,
} from '../../wagering/domain/wager-transaction';
import { LedgerDirection, WalletLedgerEntry } from '../domain/wallet-ledger-entry';
import { Wallet } from '../domain/wallet';
import type { WalletRepository } from './ports/wallet.repository';

export interface CreateWalletCommand {
  playerId: string;
  initialBalance: Money;
}

export interface WalletResult {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

export class CreateWalletUseCase {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly wallets: WalletRepository,
    private readonly wagers: WagerTransactionRepository,
    private readonly outbox: OutboxRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  execute(command: CreateWalletCommand): Promise<WalletResult> {
    return this.transactions.run(async (context) => {
      const now = this.clock.now();
      const wallet = Wallet.open({
        id: this.ids.next(),
        playerId: command.playerId,
        initialBalance: command.initialBalance,
        createdAt: now,
      });

      await this.wallets.save(wallet, context);

      if (!command.initialBalance.isZero()) {
        const opening = WagerTransaction.create({
          id: this.ids.next(),
          providerId: 'system',
          externalTransactionId: `wallet-opening:${wallet.id}`,
          idempotencyKey: `system:wallet-opening:${wallet.id}`,
          payloadHash: hashBusinessPayload({
            walletId: wallet.id,
            playerId: wallet.playerId,
            kind: WagerTransactionKind.Opening,
            money: command.initialBalance.toJSON(),
          }),
          walletId: wallet.id,
          playerId: wallet.playerId,
          roundId: `wallet-opening:${wallet.id}`,
          gameId: 'system',
          kind: WagerTransactionKind.Opening,
          money: command.initialBalance,
          referenceExternalTransactionId: undefined,
          createdAt: now,
        });
        opening.markProcessed(undefined, now, wallet.balance);
        await this.wagers.save(opening, context);

        await this.wallets.appendLedger(
          WalletLedgerEntry.create({
            id: this.ids.next(),
            walletId: wallet.id,
            transactionId: opening.id,
            direction: LedgerDirection.Credit,
            money: command.initialBalance,
            balanceBefore: command.initialBalance.subtract(command.initialBalance),
            balanceAfter: command.initialBalance,
            createdAt: now,
          }),
          context,
        );
        const eventMetadata = {
          aggregateId: wallet.id,
          occurredAt: now,
          correlationId: opening.idempotencyKey,
          causationId: opening.id,
        };
        const events = [
          new WagerProcessedEvent({
            ...eventMetadata, id: this.ids.next(), transactionId: opening.id,
            walletId: wallet.id, providerId: opening.providerId, status: opening.status,
            balance: wallet.balance.toJSON(),
          }),
          new WalletBalanceChangedEvent({
            ...eventMetadata, id: this.ids.next(), transactionId: opening.id,
            walletId: wallet.id, balanceBefore: Money.zero(wallet.currency).toJSON(),
            balanceAfter: wallet.balance.toJSON(), walletVersion: wallet.version,
          }),
        ];
        for (const event of events) {
          const payload = event.toJSON();
          await this.outbox.insert({
            id: event.id, aggregateId: wallet.id, eventType: payload.eventType, payload,
            occurredAt: event.occurredAt, attempts: 0, nextAttemptAt: undefined, publishedAt: undefined,
          }, context);
        }
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    });
  }
}
