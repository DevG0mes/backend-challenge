import type { TransactionContext } from '../../../database/transaction-runner';
import type { WalletLedgerEntry } from '../../domain/wallet-ledger-entry';
import type { Wallet } from '../../domain/wallet';

export interface WalletRepository {
  findById(id: string, context?: TransactionContext): Promise<Wallet | null>;
  findOneForUpdate(id: string, context: TransactionContext): Promise<Wallet | null>;
  save(wallet: Wallet, context: TransactionContext): Promise<void>;
  appendLedger(entry: WalletLedgerEntry, context: TransactionContext): Promise<void>;
  listLedger(walletId: string, context?: TransactionContext): Promise<WalletLedgerEntry[]>;
}
