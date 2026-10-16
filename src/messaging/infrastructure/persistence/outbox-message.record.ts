import { EntitySchema } from '@mikro-orm/core';

export class OutboxMessageRecord {
  id!: string;
  aggregateId!: string;
  eventType!: string;
  payload!: Record<string, unknown>;
  occurredAt!: Date;
  attempts = 0;
  nextAttemptAt: Date | undefined;
  publishedAt: Date | undefined;
}

export const OutboxMessageRecordSchema = new EntitySchema<OutboxMessageRecord>({
  class: OutboxMessageRecord,
  tableName: 'outbox_messages',
  properties: {
    id: { primary: true, type: 'uuid' },
    aggregateId: { fieldName: 'aggregate_id', type: 'uuid' },
    eventType: { fieldName: 'event_type', type: 'string', length: 100 },
    payload: { type: 'json' },
    occurredAt: { fieldName: 'occurred_at', type: 'datetime', columnType: 'timestamptz' },
    attempts: { type: 'integer', default: 0 },
    nextAttemptAt: { fieldName: 'next_attempt_at', type: 'datetime', columnType: 'timestamptz', nullable: true },
    publishedAt: { fieldName: 'published_at', type: 'datetime', columnType: 'timestamptz', nullable: true },
  },
});
