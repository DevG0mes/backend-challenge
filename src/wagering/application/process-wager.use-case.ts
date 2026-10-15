import type { TransactionRunner } from '../../database/transaction-runner';
import { ApplicationError } from '../../shared/application/application.error';
import { hashBusinessPayload } from '../../shared/application/canonical-json';
import type { Clock } from '../../shared/application/clock';
import type { IdGenerator } from '../../shared/application/id-generator';
import type { Money, MoneyProps } from '../../shared/domain/money/money';
import type { WalletRepository } from '../../wallet/application/ports/wallet.repository';
import { LedgerDirection, WalletLedgerEntry } from '../../wallet/domain/wallet-ledger-entry';
import { evaluateWager } from '../domain/wager-rules';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../domain/wager-transaction';
import type { WagerTransactionRepository } from './ports/wager-transaction.repository';

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
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(command: ProcessWagerCommand): Promise<ProcessWagerResult> {
    const payloadHash = this.payloadHash(command);

    try {
      return await this.transactions.run(async (context) => {
        const existing = await this.wagers.findByIdempotencyKey(command.idempotencyKey, context);
        if (existing !== null) return this.replay(existing, payloadHash);

        const wallet = await this.wallets.findOneForUpdate(command.walletId, context);
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
        } else if (decision.type === 'REJECT') {
          transaction.reject(decision.failureCode, wallet.balance);
        } else {
          if (decision.direction !== undefined) {
            const change = decision.direction === LedgerDirection.Debit
              ? wallet.debit(command.money, now)
              : wallet.credit(command.money, now);
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
        }

        await this.wagers.save(transaction, context);
        return this.result(transaction, wallet.balance.toJSON(), false);
      });
    } catch (error) {
      const existing = await this.wagers.findByIdempotencyKey(command.idempotencyKey);
      if (existing !== null) return this.replay(existing, payloadHash);
      throw error;
    }
  }

  private replay(transaction: WagerTransaction, payloadHash: string): ProcessWagerResult {
    if (!transaction.matchesPayload(payloadHash)) {
      throw new ApplicationError('IDEMPOTENCY_CONFLICT', 'The key was already used with another payload');
    }
    if (transaction.resultBalance === undefined) {
      throw new ApplicationError('MISSING_RESULT_BALANCE', 'Stored transaction has no balance snapshot');
    }
    return this.result(transaction, transaction.resultBalance.toJSON(), true);
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
}
