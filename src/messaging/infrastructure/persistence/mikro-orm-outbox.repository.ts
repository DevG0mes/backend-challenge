import { LockMode, QueryOrder } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { entityManagerFrom } from '../../../database/postgres-transaction-runner';
import type { TransactionContext } from '../../../database/transaction-runner';
import type { OutboxRecordData, OutboxRepository } from '../../application/ports/outbox.repository';
import { OutboxMessageRecord } from './outbox-message.record';

export class MikroOrmOutboxRepository implements OutboxRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async insert(message: OutboxRecordData, context: TransactionContext): Promise<void> {
    entityManagerFrom(context).persist(Object.assign(new OutboxMessageRecord(), message));
  }

  async claimDue(
    now: Date,
    limit: number,
    context: TransactionContext,
  ): Promise<OutboxRecordData[]> {
    const records = await entityManagerFrom(context).find(
      OutboxMessageRecord,
      {
        publishedAt: null,
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      },
      {
        limit,
        orderBy: { occurredAt: QueryOrder.ASC, id: QueryOrder.ASC },
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
      },
    );
    return records.map((record) => ({ ...record }));
  }

  async save(message: OutboxRecordData, context: TransactionContext): Promise<void> {
    await entityManagerFrom(context).upsert(
      OutboxMessageRecord,
      Object.assign(new OutboxMessageRecord(), message),
    );
  }
}
