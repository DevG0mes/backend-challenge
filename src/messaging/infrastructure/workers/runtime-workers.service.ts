import type { BeforeApplicationShutdown, OnApplicationBootstrap } from '@nestjs/common';
import type { SQSClient } from '@aws-sdk/client-sqs';

import type { OutboxPublisherWorker } from '../sqs/outbox-publisher.worker';
import type { WagerConsumerWorker } from '../sqs/wager-consumer.worker';
import type { PendingReferenceWorker } from '../../../wagering/infrastructure/workers/pending-reference.worker';

export class RuntimeWorkersService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  constructor(
    private readonly consumer?: WagerConsumerWorker,
    private readonly outbox?: OutboxPublisherWorker,
    private readonly pendingReferences?: PendingReferenceWorker,
    private readonly sqs?: SQSClient,
  ) {}

  onApplicationBootstrap(): void {
    this.consumer?.start();
    this.outbox?.start();
    this.pendingReferences?.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.consumer?.stopPolling();
    this.outbox?.stopPolling();
    this.pendingReferences?.stopPolling();
    await Promise.all([
      this.consumer?.drain(5_000),
      this.outbox?.drain(5_000),
      this.pendingReferences?.drain(5_000),
    ]);
    this.sqs?.destroy();
  }
}
