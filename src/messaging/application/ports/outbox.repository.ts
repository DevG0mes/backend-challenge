import type { TransactionContext } from '../../../database/transaction-runner';

export interface OutboxRecordData {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date | undefined;
  publishedAt: Date | undefined;
}

export interface OutboxRepository {
  insert(message: OutboxRecordData, context: TransactionContext): Promise<void>;
  claimDue(now: Date, limit: number, leaseUntil: Date, context: TransactionContext): Promise<OutboxRecordData[]>;
  save(message: OutboxRecordData, context: TransactionContext): Promise<void>;
}
