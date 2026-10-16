import { EntitySchema } from '@mikro-orm/core';

export class InboxMessageRecord {
  consumerName!: string;
  messageId!: string;
  payloadHash!: string;
  receivedAt!: Date;
  processedAt: Date | undefined;
}

export const InboxMessageRecordSchema = new EntitySchema<InboxMessageRecord>({
  class: InboxMessageRecord,
  tableName: 'inbox_messages',
  properties: {
    consumerName: { fieldName: 'consumer_name', primary: true, type: 'string', length: 100 },
    messageId: { fieldName: 'message_id', primary: true, type: 'string', length: 255 },
    payloadHash: { fieldName: 'payload_hash', type: 'string', length: 64 },
    receivedAt: { fieldName: 'received_at', type: 'datetime', columnType: 'timestamptz' },
    processedAt: { fieldName: 'processed_at', type: 'datetime', columnType: 'timestamptz', nullable: true },
  },
});
