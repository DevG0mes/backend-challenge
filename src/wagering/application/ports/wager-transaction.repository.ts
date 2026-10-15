import type { TransactionContext } from '../../../database/transaction-runner';
import type { WagerTransaction } from '../../domain/wager-transaction';

export interface WagerTransactionRepository {
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
  save(transaction: WagerTransaction, context: TransactionContext): Promise<void>;
}
