import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { CreateQueueCommand, PurgeQueueCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import { createMikroOrmConfig } from '../../../src/database/mikro-orm.config';
import { PostgresTransactionRunner } from '../../../src/database/postgres-transaction-runner';
import { PublishOutboxBatchUseCase, type OutboxEventPublisher } from '../../../src/messaging/application/publish-outbox.use-case';
import type { OutboxRecordData } from '../../../src/messaging/application/ports/outbox.repository';
import { MikroOrmOutboxRepository } from '../../../src/messaging/infrastructure/persistence/mikro-orm-outbox.repository';
import { SqsOutboxEventPublisher } from '../../../src/messaging/infrastructure/sqs/sqs-outbox-event.publisher';
import { InMemoryMetrics } from '../../../src/shared/observability/metrics';

const NOW = new Date('2026-10-16T12:00:00.000Z');

describe('concurrent outbox publisher', () => {
  let orm: MikroORM;
  let transactions: PostgresTransactionRunner;
  let repository: MikroOrmOutboxRepository;
  let aws: SQSClient;
  let eventQueueUrl: string;
  let metrics: InMemoryMetrics;

  beforeAll(async () => {
    orm = await MikroORM.init(createMikroOrmConfig({ host: '127.0.0.1', port: Number(process.env.TEST_POSTGRES_PORT ?? '55432'), dbName: 'wagering_core', user: 'dw_app', password: 'dw_local_N7v4K2p9' }));
    await orm.migrator.up();
    transactions = new PostgresTransactionRunner(orm.em);
    repository = new MikroOrmOutboxRepository(orm.em);
    aws = new SQSClient({ region: 'us-east-1', endpoint: process.env.SQS_ENDPOINT ?? 'http://127.0.0.1:4566', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
    eventQueueUrl = (await aws.send(new CreateQueueCommand({ QueueName: 'wager-events-test.fifo', Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'true' } }))).QueueUrl!;
  });

  beforeEach(async () => {
    metrics = new InMemoryMetrics();
    await orm.em.getConnection().execute('truncate outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade');
    await aws.send(new PurgeQueueCommand({ QueueUrl: eventQueueUrl }));
  });
  afterAll(async () => { aws.destroy(); await orm.close(true); });

  test('publishes one due message and records lag', async () => {
    await seed(message('0192f299-345e-7e38-af88-e43f851a8101', -5_000));
    const target = new RecordingPublisher();
    const result = await useCase(target).execute(NOW, 10);
    expect(result).toEqual({ claimed: 1, published: 1, failed: 0, oldestLagMs: 5_000 });
    expect(metrics.gauge('outbox_lag_seconds')).toBe(5);
    expect(target.ids).toEqual(['0192f299-345e-7e38-af88-e43f851a8101']);
    expect(await publishedCount()).toBe('1');
  });

  test('two publishers claim each row once', async () => {
    for (let index = 1; index <= 10; index += 1) {
      await seed(message(`0192f299-345e-7e38-af88-e43f851a81${index.toString().padStart(2, '0')}`, -1_000));
    }
    const target = new RecordingPublisher(10);
    await Promise.all([useCase(target).execute(NOW, 10), useCase(target).execute(NOW, 10)]);
    expect(target.ids).toHaveLength(10);
    expect(new Set(target.ids).size).toBe(10);
    expect(await publishedCount()).toBe('10');
  });

  test('publication failure schedules exponential retry', async () => {
    await seed(message('0192f299-345e-7e38-af88-e43f851a8120', 0));
    const result = await useCase(new RecordingPublisher(0, true)).execute(NOW, 10);
    expect(result.failed).toBe(1);
    expect(metrics.counter('outbox_retries_total', { eventType: 'WagerProcessed' })).toBe(1);
    const rows = await orm.em.getConnection().execute<{ attempts: number; next_attempt_at: Date }[]>('select attempts, next_attempt_at from outbox_messages');
    expect(rows[0]?.attempts).toBe(1);
    expect(new Date(rows[0]!.next_attempt_at).toISOString()).toBe('2026-10-16T12:00:01.000Z');
  });

  test('a restarted publisher resumes pending rows', async () => {
    await seed(message('0192f299-345e-7e38-af88-e43f851a8130', 0));
    await useCase(new RecordingPublisher(0, true)).execute(NOW, 10);
    const restarted = new RecordingPublisher();
    expect((await useCase(restarted).execute(new Date(NOW.getTime() + 1_000), 10)).published).toBe(1);
  });

  test('crash after send re-publishes the same stable event ID', async () => {
    const id = '0192f299-345e-7e38-af88-e43f851a8140';
    await seed(message(id, 0));
    const target = new RecordingPublisher(0, true);
    await useCase(target).execute(NOW, 10);
    target.fail = false;
    await useCase(target).execute(new Date(NOW.getTime() + 1_000), 10);
    expect(target.ids).toEqual([id, id]);
  });

  test('publishes the outbox envelope to an SQS FIFO queue', async () => {
    const data = message('0192f299-345e-7e38-af88-e43f851a8150', 0);
    await new SqsOutboxEventPublisher(aws, eventQueueUrl).publish(data);
    const received = await aws.send(new ReceiveMessageCommand({ QueueUrl: eventQueueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 1 }));
    expect(JSON.parse(received.Messages?.[0]?.Body ?? '{}')).toEqual(data.payload);
  });

  function useCase(target: OutboxEventPublisher): PublishOutboxBatchUseCase {
    return new PublishOutboxBatchUseCase(transactions, repository, target, { baseRetryMs: 1_000, maxRetryMs: 60_000, leaseMs: 30_000 }, metrics);
  }

  async function seed(data: OutboxRecordData): Promise<void> {
    await transactions.run((context) => repository.insert(data, context));
  }

  function message(id: string, offsetMs: number): OutboxRecordData {
    return { id, aggregateId: '0192f291-27dd-7d3f-8071-5f8685deef37', eventType: 'WagerProcessed', payload: { id, type: 'WagerProcessed' }, occurredAt: new Date(NOW.getTime() + offsetMs), attempts: 0, nextAttemptAt: undefined, publishedAt: undefined };
  }

  async function publishedCount(): Promise<string> {
    const rows = await orm.em.getConnection().execute<{ count: string }[]>('select count(*)::text as count from outbox_messages where published_at is not null');
    return rows[0]?.count ?? 'missing';
  }
});

class RecordingPublisher implements OutboxEventPublisher {
  readonly ids: string[] = [];
  constructor(private readonly delayMs = 0, public fail = false) {}
  async publish(message: OutboxRecordData): Promise<void> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.ids.push(message.id);
    if (this.fail) throw new Error('publish failed after send');
  }
}
