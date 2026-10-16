import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { CreateQueueCommand, GetQueueAttributesCommand, PurgeQueueCommand, SendMessageCommand, SetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';

import { createMikroOrmConfig } from '../../../src/database/mikro-orm.config';
import { PostgresTransactionRunner } from '../../../src/database/postgres-transaction-runner';
import { ConsumeWagerMessageUseCase, type WagerMessageEnvelope } from '../../../src/messaging/application/consume-wager-message.use-case';
import { MikroOrmInboxRepository } from '../../../src/messaging/infrastructure/persistence/mikro-orm-inbox.repository';
import { MikroOrmOutboxRepository } from '../../../src/messaging/infrastructure/persistence/mikro-orm-outbox.repository';
import { AwsSqsClient } from '../../../src/messaging/infrastructure/sqs/sqs.client';
import { WagerConsumerWorker } from '../../../src/messaging/infrastructure/sqs/wager-consumer.worker';
import { RandomIdGenerator } from '../../../src/shared/application/id-generator';
import { InMemoryMetrics } from '../../../src/shared/observability/metrics';
import { Money } from '../../../src/shared/domain/money/money';
import { CreateWalletUseCase } from '../../../src/wallet/application/create-wallet.use-case';
import { MikroOrmWalletRepository } from '../../../src/wallet/infrastructure/persistence/mikro-orm-wallet.repository';
import { ProcessWagerUseCase } from '../../../src/wagering/application/process-wager.use-case';
import { WagerTransactionKind } from '../../../src/wagering/domain/wager-transaction';
import { MikroOrmWagerTransactionRepository } from '../../../src/wagering/infrastructure/persistence/mikro-orm-wager-transaction.repository';

const PLAYER_ID = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';
const endpoint = process.env.SQS_ENDPOINT ?? 'http://127.0.0.1:4566';
const aws = new SQSClient({ region: 'us-east-1', endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
let queueUrl = '';
let dlqUrl = '';

describe('LocalStack SQS wager consumer', () => {
  let orm: MikroORM;
  let consume: ConsumeWagerMessageUseCase;
  let walletId: string;
  let metrics: InMemoryMetrics;

  beforeAll(async () => {
    dlqUrl = (await aws.send(new CreateQueueCommand({ QueueName: 'wager-transactions-dlq-test.fifo', Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'true' } }))).QueueUrl!;
    const dlqArn = (await aws.send(new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: ['QueueArn'] }))).Attributes!.QueueArn!;
    queueUrl = (await aws.send(new CreateQueueCommand({ QueueName: 'wager-transactions-test.fifo', Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'true' } }))).QueueUrl!;
    await aws.send(new SetQueueAttributesCommand({ QueueUrl: queueUrl, Attributes: { VisibilityTimeout: '30', RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 3 }) } }));

    orm = await MikroORM.init(createMikroOrmConfig({ host: '127.0.0.1', port: Number(process.env.TEST_POSTGRES_PORT ?? '55432'), dbName: 'wagering', user: 'wagering', password: 'wagering' }));
    await orm.migrator.up();
    const transactions = new PostgresTransactionRunner(orm.em);
    const wallets = new MikroOrmWalletRepository(orm.em);
    const wagers = new MikroOrmWagerTransactionRepository(orm.em);
    const outbox = new MikroOrmOutboxRepository(orm.em);
    const ids = new RandomIdGenerator();
    const clock = { now: () => new Date('2026-10-16T12:00:00.000Z') };
    consume = new ConsumeWagerMessageUseCase(transactions, new MikroOrmInboxRepository(orm.em), new ProcessWagerUseCase(transactions, wallets, wagers, outbox, ids, clock), clock);
    const createWallet = new CreateWalletUseCase(transactions, wallets, wagers, outbox, ids, clock);
    await orm.em.getConnection().execute('truncate outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade');
    walletId = (await createWallet.execute({ playerId: PLAYER_ID, initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }) })).id;
  });

  beforeEach(async () => {
    metrics = new InMemoryMetrics();
    await aws.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
    await aws.send(new PurgeQueueCommand({ QueueUrl: dlqUrl }));
  });

  afterAll(async () => { aws.destroy(); await orm.close(true); });

  test('consumes and acknowledges a valid wager', async () => {
    await send(JSON.stringify(envelope('valid-message')));
    const worker = workerFor(consume);
    expect(await worker.processNext()).toBe('ACK');
    expect(await worker.processNext()).toBe('EMPTY');
  });

  test('routes malformed JSON directly to the DLQ', async () => {
    await send('{not-json');
    const worker = workerFor(consume);
    expect(await worker.processNext()).toBe('DLQ');
    expect(metrics.counter('sqs_dlq_messages_total', { consumer: 'wager' })).toBe(1);
    const dlq = new AwsSqsClient(aws, dlqUrl, dlqUrl);
    expect((await dlq.receiveOne())?.body).toBe('{not-json');
  });

  test('acknowledges an auditable business rejection', async () => {
    const rejected = envelope('rejected-bet');
    rejected.data.money.amount = '9999.00';
    await send(JSON.stringify(rejected));
    expect(await workerFor(consume).processNext()).toBe('ACK');
  });

  test('routes a structurally invalid JSON envelope to the DLQ', async () => {
    await send(JSON.stringify({ messageId: 'invalid-contract', data: {} }));
    expect(await workerFor(consume).processNext()).toBe('DLQ');
  });

  test('retries transient failures and sends the final attempt to the DLQ', async () => {
    await send(JSON.stringify(envelope('retry-message')));
    const failing = { execute: async () => { throw new Error('database unavailable'); } };
    const worker = workerFor(failing);
    expect(await worker.processNext()).toBe('RETRY');
    expect(await worker.processNext()).toBe('RETRY');
    expect(await worker.processNext()).toBe('DLQ');
    expect(metrics.counter('sqs_retries_total', { consumer: 'wager' })).toBe(2);
    expect(metrics.counter('sqs_dlq_messages_total', { consumer: 'wager' })).toBe(1);
  });

  test('redelivery after commit-before-ack is an idempotent acknowledgement', async () => {
    await send(JSON.stringify(envelope('crash-window')));
    const actual = new AwsSqsClient(aws, queueUrl, dlqUrl);
    let failDelete = true;
    const crashTransport = {
      receiveOne: () => actual.receiveOne(),
      retry: (message: Parameters<typeof actual.retry>[0]) => actual.retry(message),
      moveToDlq: (message: Parameters<typeof actual.moveToDlq>[0]) => actual.moveToDlq(message),
      acknowledge: async (message: Parameters<typeof actual.acknowledge>[0]) => {
        if (failDelete) {
          failDelete = false;
          await actual.retry(message);
          throw new Error('simulated delete failure');
        }
        await actual.acknowledge(message);
      },
    };
    const worker = new WagerConsumerWorker(crashTransport, consume, { maxReceiveCount: 3 });
    expect(await worker.processNext()).toBe('RETRY');
    expect(await worker.processNext()).toBe('ACK');
  });

  test('stops polling and reports whether in-flight work drained in time', async () => {
    await send(JSON.stringify(envelope('drain-message')));
    let release!: () => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const handler = { execute: async () => { signalStarted(); await blocked; } };
    const worker = workerFor(handler);
    worker.start();
    await started;
    worker.stopPolling();
    expect(await worker.drain(10)).toBeFalse();
    release();
    expect(await worker.drain(2_000)).toBeTrue();
  });

  function workerFor(handler: { execute(envelope: WagerMessageEnvelope): Promise<unknown> }): WagerConsumerWorker {
    return new WagerConsumerWorker(new AwsSqsClient(aws, queueUrl, dlqUrl), handler, { maxReceiveCount: 3 }, metrics);
  }

  async function send(body: string): Promise<void> {
    await aws.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body, MessageGroupId: 'wallet-1' }));
  }

  function envelope(messageId: string): WagerMessageEnvelope {
    return { messageId, data: { providerId: 'provider-a', externalTransactionId: messageId, idempotencyKey: `provider-a:${messageId}`, playerId: PLAYER_ID, walletId, roundId: 'round-1', gameId: 'game-1', kind: WagerTransactionKind.Bet, money: { amount: '1.00', currency: 'BRL' } } };
  }
});
