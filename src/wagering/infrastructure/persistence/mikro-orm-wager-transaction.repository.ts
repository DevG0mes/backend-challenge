import { LockMode, QueryOrder } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { entityManagerFrom } from '../../../database/postgres-transaction-runner';
import type { TransactionContext } from '../../../database/transaction-runner';
import type { WagerTransactionRepository } from '../../application/ports/wager-transaction.repository';
import type { WagerTransaction } from '../../domain/wager-transaction';
import { WagerTransactionMapper } from './wager-transaction.mapper';
import { WagerTransactionRecord } from './wager-transaction.record';

export class MikroOrmWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async claimDuePending(
    now: Date,
    limit: number,
    leaseUntil: Date,
    context: TransactionContext,
  ): Promise<WagerTransaction[]> {
    const manager = entityManagerFrom(context);
    const records = await manager.find(
      WagerTransactionRecord,
      {
        status: 'PENDING_REFERENCE',
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      },
      {
        limit,
        orderBy: { createdAt: QueryOrder.ASC, id: QueryOrder.ASC },
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
      },
    );
    for (const record of records) record.nextAttemptAt = leaseUntil;
    await manager.flush();
    return records.map(WagerTransactionMapper.toDomain);
  }

  findById(id: string, context?: TransactionContext): Promise<WagerTransaction | null> {
    return this.findOne({ id }, context);
  }

  findByIdempotencyKey(
    idempotencyKey: string,
    context?: TransactionContext,
  ): Promise<WagerTransaction | null> {
    return this.findOne({ idempotencyKey }, context);
  }

  findByProviderExternal(
    providerId: string,
    externalTransactionId: string,
    context?: TransactionContext,
  ): Promise<WagerTransaction | null> {
    return this.findOne({ providerId, externalTransactionId }, context);
  }

  async findProcessedReversals(
    referenceTransactionId: string,
    context?: TransactionContext,
  ): Promise<WagerTransaction[]> {
    const manager = context === undefined ? this.entityManager.fork() : entityManagerFrom(context);
    const records = await manager.find(WagerTransactionRecord, {
      referenceTransactionId,
      status: 'PROCESSED',
    });
    return records.map(WagerTransactionMapper.toDomain);
  }

  async save(transaction: WagerTransaction, context: TransactionContext): Promise<void> {
    await entityManagerFrom(context).upsert(
      WagerTransactionRecord,
      WagerTransactionMapper.toRecord(transaction),
    );
  }

  private async findOne(
    where: Partial<WagerTransactionRecord>,
    context?: TransactionContext,
  ): Promise<WagerTransaction | null> {
    const manager = context === undefined ? this.entityManager.fork() : entityManagerFrom(context);
    const record = await manager.findOne(WagerTransactionRecord, where);
    return record === null ? null : WagerTransactionMapper.toDomain(record);
  }
}
