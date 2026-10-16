import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';

import type { OutboxEventPublisher } from '../../application/publish-outbox.use-case';
import type { OutboxRecordData } from '../../application/ports/outbox.repository';

export class SqsOutboxEventPublisher implements OutboxEventPublisher {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async publish(message: OutboxRecordData): Promise<void> {
    await this.client.send(new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(message.payload),
      MessageGroupId: message.aggregateId,
      MessageDeduplicationId: message.id,
    }));
  }
}
