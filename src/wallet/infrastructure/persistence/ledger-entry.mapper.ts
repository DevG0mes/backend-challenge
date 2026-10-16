import { Money } from '../../../shared/domain/money/money';
import { LedgerDirection, WalletLedgerEntry } from '../../domain/wallet-ledger-entry';
import { LedgerEntryRecord } from './ledger-entry.record';

export class LedgerEntryMapper {
  static toDomain(record: LedgerEntryRecord): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: record.id,
      walletId: record.walletId,
      transactionId: record.transactionId,
      direction: record.direction as LedgerDirection,
      money: Money.from({ amount: record.amount, currency: record.currency }),
      balanceBefore: Money.from({ amount: record.balanceBefore, currency: record.currency }),
      balanceAfter: Money.from({ amount: record.balanceAfter, currency: record.currency }),
      createdAt: record.createdAt,
    });
  }

  static toRecord(entry: WalletLedgerEntry): LedgerEntryRecord {
    const record = new LedgerEntryRecord();
    record.id = entry.id;
    record.walletId = entry.walletId;
    record.transactionId = entry.transactionId;
    record.direction = entry.direction;
    record.amount = entry.money.toJSON().amount;
    record.currency = entry.money.currency;
    record.balanceBefore = entry.balanceBefore.toJSON().amount;
    record.balanceAfter = entry.balanceAfter.toJSON().amount;
    record.createdAt = entry.createdAt;
    return record;
  }
}
