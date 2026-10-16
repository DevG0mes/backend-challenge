import { EntitySchema } from '@mikro-orm/core';

export class WalletRecord {
  id!: string;
  playerId!: string;
  currency!: string;
  balance!: string;
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export const WalletRecordSchema = new EntitySchema<WalletRecord>({
  class: WalletRecord,
  tableName: 'wallets',
  properties: {
    id: { primary: true, type: 'uuid' },
    playerId: { fieldName: 'player_id', type: 'uuid' },
    currency: { type: 'string', length: 3 },
    balance: { type: 'decimal', runtimeType: 'string', columnType: 'numeric(40,2)' },
    version: { type: 'integer' },
    createdAt: { fieldName: 'created_at', type: 'datetime', columnType: 'timestamptz' },
    updatedAt: { fieldName: 'updated_at', type: 'datetime', columnType: 'timestamptz' },
  },
});
