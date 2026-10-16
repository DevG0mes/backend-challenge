import { EntitySchema } from '@mikro-orm/core';

export class LedgerEntryRecord {
  id!: string;
  walletId!: string;
  transactionId!: string;
  direction!: string;
  amount!: string;
  currency!: string;
  balanceBefore!: string;
  balanceAfter!: string;
  createdAt!: Date;
}

export const LedgerEntryRecordSchema = new EntitySchema<LedgerEntryRecord>({
  class: LedgerEntryRecord,
  tableName: 'wallet_ledger_entries',
  properties: {
    id: { primary: true, type: 'uuid' },
    walletId: { fieldName: 'wallet_id', type: 'uuid' },
    transactionId: { fieldName: 'transaction_id', type: 'uuid' },
    direction: { type: 'string', length: 6 },
    amount: { type: 'decimal', runtimeType: 'string', columnType: 'numeric(40,2)' },
    currency: { type: 'string', length: 3 },
    balanceBefore: { fieldName: 'balance_before', type: 'decimal', runtimeType: 'string', columnType: 'numeric(40,2)' },
    balanceAfter: { fieldName: 'balance_after', type: 'decimal', runtimeType: 'string', columnType: 'numeric(40,2)' },
    createdAt: { fieldName: 'created_at', type: 'datetime', columnType: 'timestamptz' },
  },
});
