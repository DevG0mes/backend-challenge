import { ApplicationError } from '../../shared/application/application.error';
import { Money, type MoneyProps } from '../../shared/domain/money/money';
import { LedgerDirection } from '../domain/wallet-ledger-entry';
import type { WalletRepository } from './ports/wallet.repository';
import type { OperationalMetrics } from '../../shared/observability/metrics';
import type { StructuredLogger } from '../../shared/observability/logger';
import type { TransactionRunner } from '../../database/transaction-runner';

export interface ReconciliationResult {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

export class ReconcileWalletUseCase {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly wallets: WalletRepository,
    private readonly metrics?: OperationalMetrics,
    private readonly logger?: StructuredLogger,
  ) {}

  async execute(walletId: string): Promise<ReconciliationResult> {
    const snapshot = await this.transactions.run(async (context) => {
      const wallet = await this.wallets.findOneForUpdate(walletId, context);
      if (wallet === null) throw new ApplicationError('WALLET_NOT_FOUND', `Wallet ${walletId} was not found`);
      return { wallet, entries: await this.wallets.listLedger(walletId, context) };
    });
    const { wallet, entries } = snapshot;
    let calculated = Money.zero(wallet.currency);
    for (const entry of entries) {
      calculated = entry.direction === LedgerDirection.Credit
        ? calculated.add(entry.money)
        : calculated.subtract(entry.money);
    }
    const result = {
      walletId,
      storedBalance: wallet.balance.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: calculated.subtract(wallet.balance).toJSON(),
      consistent: calculated.equals(wallet.balance),
      checkedEntries: entries.length,
    };
    this.metrics?.increment('wallet_reconciliations_total', { consistent: String(result.consistent) });
    if (!result.consistent) {
      this.metrics?.increment('wallet_reconciliation_mismatches_total');
      this.logger?.warn('wallet reconciliation mismatch', {
        walletId,
        storedBalance: result.storedBalance,
        calculatedBalance: result.calculatedBalance,
      });
    }
    return result;
  }
}
