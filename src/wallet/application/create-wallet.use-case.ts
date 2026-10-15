import type { TransactionRunner } from '../../database/transaction-runner';
import { hashBusinessPayload } from '../../shared/application/canonical-json';
import type { Clock } from '../../shared/application/clock';
import type { IdGenerator } from '../../shared/application/id-generator';
import type { Money, MoneyProps } from '../../shared/domain/money/money';
import type { WagerTransactionRepository } from '../../wagering/application/ports/wager-transaction.repository';
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
        opening.markProcessed(undefined, now);
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
