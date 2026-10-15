import type { TransactionContext } from '../../../database/transaction-runner';

export interface InboxRecordData {
  consumerName: string;
  messageId: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt: Date | undefined;
}

export interface InboxRepository {
  find(
    consumerName: string,
    messageId: string,
    context: TransactionContext,
  ): Promise<InboxRecordData | null>;
  insert(message: InboxRecordData, context: TransactionContext): Promise<void>;
  markProcessed(
    consumerName: string,
    messageId: string,
    at: Date,
    context: TransactionContext,
  ): Promise<void>;
}
