import type { TransactionContext } from '../../../database/transaction-runner';
import type { WagerTransaction } from '../../domain/wager-transaction';

export interface WagerTransactionRepository {
  claimDuePending(
    now: Date,
    limit: number,
    leaseUntil: Date,
    context: TransactionContext,
  ): Promise<WagerTransaction[]>;
  findById(id: string, context?: TransactionContext): Promise<WagerTransaction | null>;
  findByIdempotencyKey(
    idempotencyKey: string,
    context?: TransactionContext,
  ): Promise<WagerTransaction | null>;
  findByProviderExternal(
    providerId: string,
    externalTransactionId: string,
    context?: TransactionContext,
  ): Promise<WagerTransaction | null>;
  findProcessedReversals(
    referenceTransactionId: string,
    context?: TransactionContext,
  ): Promise<WagerTransaction[]>;
  save(transaction: WagerTransaction, context: TransactionContext): Promise<void>;
}
