import type { EntityManager } from '@mikro-orm/postgresql';

import { entityManagerFrom } from '../../../database/postgres-transaction-runner';
import type { TransactionContext } from '../../../database/transaction-runner';
import type { InboxRecordData, InboxRepository } from '../../application/ports/inbox.repository';
import { InboxMessageRecord } from './inbox-message.record';

export class MikroOrmInboxRepository implements InboxRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async find(
    consumerName: string,
    messageId: string,
    context: TransactionContext,
  ): Promise<InboxRecordData | null> {
    const record = await entityManagerFrom(context).findOne(InboxMessageRecord, {
      consumerName,
      messageId,
    });
    return record === null ? null : { ...record };
  }

  async insert(message: InboxRecordData, context: TransactionContext): Promise<void> {
    entityManagerFrom(context).persist(Object.assign(new InboxMessageRecord(), message));
  }

  async markProcessed(
    consumerName: string,
    messageId: string,
    at: Date,
    context: TransactionContext,
  ): Promise<void> {
    await entityManagerFrom(context).nativeUpdate(
      InboxMessageRecord,
      { consumerName, messageId },
      { processedAt: at },
    );
  }
}
