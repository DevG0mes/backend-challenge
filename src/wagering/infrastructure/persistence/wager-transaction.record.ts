import { EntitySchema } from '@mikro-orm/core';

export class WagerTransactionRecord {
  id!: string;
  providerId!: string;
  externalTransactionId!: string;
  idempotencyKey!: string;
  payloadHash!: string;
  walletId!: string;
  playerId!: string;
  roundId!: string;
  gameId!: string;
  kind!: string;
  amount!: string;
  currency!: string;
  referenceExternalTransactionId: string | undefined;
  referenceTransactionId: string | undefined;
  status!: string;
  failureCode: string | undefined;
  resultBalance: string | undefined;
  resultCurrency: string | undefined;
  pendingAttempts = 0;
  nextAttemptAt: Date | undefined;
  processedAt: Date | undefined;
  createdAt!: Date;
}

export const WagerTransactionRecordSchema = new EntitySchema<WagerTransactionRecord>({
  class: WagerTransactionRecord,
  tableName: 'wager_transactions',
  properties: {
    id: { primary: true, type: 'uuid' },
    providerId: { fieldName: 'provider_id', type: 'string', length: 100 },
    externalTransactionId: { fieldName: 'external_transaction_id', type: 'string', length: 255 },
    idempotencyKey: { fieldName: 'idempotency_key', type: 'string', length: 255 },
    payloadHash: { fieldName: 'payload_hash', type: 'string', length: 64 },
    walletId: { fieldName: 'wallet_id', type: 'uuid' },
    playerId: { fieldName: 'player_id', type: 'uuid' },
    roundId: { fieldName: 'round_id', type: 'string', length: 255 },
    gameId: { fieldName: 'game_id', type: 'string', length: 255 },
    kind: { type: 'string', length: 16 },
    amount: { type: 'decimal', runtimeType: 'string', columnType: 'numeric(40,2)' },
    currency: { type: 'string', length: 3 },
    referenceExternalTransactionId: { fieldName: 'reference_external_transaction_id', type: 'string', length: 255, nullable: true },
    referenceTransactionId: { fieldName: 'reference_transaction_id', type: 'uuid', nullable: true },
    status: { type: 'string', length: 24 },
    failureCode: { fieldName: 'failure_code', type: 'string', length: 64, nullable: true },
    resultBalance: { fieldName: 'result_balance', type: 'decimal', runtimeType: 'string', columnType: 'numeric(40,2)', nullable: true },
    resultCurrency: { fieldName: 'result_currency', type: 'string', length: 3, nullable: true },
    pendingAttempts: { fieldName: 'pending_attempts', type: 'integer', default: 0 },
    nextAttemptAt: { fieldName: 'next_attempt_at', type: 'datetime', columnType: 'timestamptz', nullable: true },
    processedAt: { fieldName: 'processed_at', type: 'datetime', columnType: 'timestamptz', nullable: true },
    createdAt: { fieldName: 'created_at', type: 'datetime', columnType: 'timestamptz' },
  },
});
