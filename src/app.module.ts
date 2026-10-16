import { Module } from '@nestjs/common';
import { MikroORM as CoreMikroORM } from '@mikro-orm/core';
import type { MikroORM } from '@mikro-orm/postgresql';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { GetQueueUrlCommand, ListQueuesCommand, SQSClient } from '@aws-sdk/client-sqs';

import mikroOrmConfig from './database/mikro-orm.config';
import { PostgresTransactionRunner } from './database/postgres-transaction-runner';
import { HealthController } from './health/health.controller';
import { ReadinessService } from './health/readiness.service';
import { SystemClock } from './shared/application/clock';
import { RandomIdGenerator } from './shared/application/id-generator';
import { DomainExceptionFilter } from './shared/interface/http/domain-exception.filter';
import { ProviderAuthGuard } from './shared/interface/http/provider-auth.guard';
import { StructuredLogger } from './shared/observability/logger';
import { InMemoryMetrics } from './shared/observability/metrics';
import { CreateWalletUseCase } from './wallet/application/create-wallet.use-case';
import { GetWalletUseCase } from './wallet/application/get-wallet.use-case';
import { ListLedgerUseCase } from './wallet/application/list-ledger.use-case';
import { ReconcileWalletUseCase } from './wallet/application/reconcile-wallet.use-case';
import { WalletController } from './wallet/interface/http/wallet.controller';
import { MikroOrmWalletRepository } from './wallet/infrastructure/persistence/mikro-orm-wallet.repository';
import { ProcessWagerUseCase } from './wagering/application/process-wager.use-case';
import { GetWagerTransactionUseCase } from './wagering/application/get-wager-transaction.use-case';
import { ProviderWageringController, WageringController } from './wagering/interface/http/wagering.controller';
import { MikroOrmWagerTransactionRepository } from './wagering/infrastructure/persistence/mikro-orm-wager-transaction.repository';
import { MikroOrmOutboxRepository } from './messaging/infrastructure/persistence/mikro-orm-outbox.repository';
import { MikroOrmInboxRepository } from './messaging/infrastructure/persistence/mikro-orm-inbox.repository';
import { ConsumeWagerMessageUseCase } from './messaging/application/consume-wager-message.use-case';
import { PublishOutboxBatchUseCase } from './messaging/application/publish-outbox.use-case';
import { AwsSqsClient } from './messaging/infrastructure/sqs/sqs.client';
import { SqsOutboxEventPublisher } from './messaging/infrastructure/sqs/sqs-outbox-event.publisher';
import { WagerConsumerWorker } from './messaging/infrastructure/sqs/wager-consumer.worker';
import { OutboxPublisherWorker } from './messaging/infrastructure/sqs/outbox-publisher.worker';
import { RuntimeWorkersService } from './messaging/infrastructure/workers/runtime-workers.service';
import { ReprocessPendingReferencesUseCase } from './wagering/application/reprocess-pending-references.use-case';
import { PendingReferenceWorker } from './wagering/infrastructure/workers/pending-reference.worker';

@Module({
  imports: [MikroOrmModule.forRoot(mikroOrmConfig)],
  controllers: [HealthController, WalletController, WageringController, ProviderWageringController],
  providers: [
    DomainExceptionFilter,
    ProviderAuthGuard,
    SystemClock,
    RandomIdGenerator,
    { provide: StructuredLogger, useFactory: () => new StructuredLogger() },
    InMemoryMetrics,
    {
      provide: ReadinessService,
      inject: [CoreMikroORM],
      useFactory: (orm: MikroORM) => {
        const sqs = new SQSClient({
          region: process.env.AWS_REGION ?? 'us-east-1',
          endpoint: process.env.SQS_ENDPOINT ?? 'http://127.0.0.1:4566',
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
          },
        });
        return new ReadinessService(
          { check: async () => { await orm.em.getConnection().execute('select 1'); } },
          { check: async () => { await sqs.send(new ListQueuesCommand({ MaxResults: 1 })); } },
        );
      },
    },
    { provide: PostgresTransactionRunner, inject: [CoreMikroORM], useFactory: (orm: MikroORM) => new PostgresTransactionRunner(orm.em) },
    { provide: MikroOrmWalletRepository, inject: [CoreMikroORM], useFactory: (orm: MikroORM) => new MikroOrmWalletRepository(orm.em) },
    { provide: MikroOrmWagerTransactionRepository, inject: [CoreMikroORM], useFactory: (orm: MikroORM) => new MikroOrmWagerTransactionRepository(orm.em) },
    { provide: MikroOrmOutboxRepository, inject: [CoreMikroORM], useFactory: (orm: MikroORM) => new MikroOrmOutboxRepository(orm.em) },
    { provide: MikroOrmInboxRepository, inject: [CoreMikroORM], useFactory: (orm: MikroORM) => new MikroOrmInboxRepository(orm.em) },
    { provide: GetWalletUseCase, inject: [MikroOrmWalletRepository], useFactory: (wallets: MikroOrmWalletRepository) => new GetWalletUseCase(wallets) },
    { provide: ListLedgerUseCase, inject: [MikroOrmWalletRepository], useFactory: (wallets: MikroOrmWalletRepository) => new ListLedgerUseCase(wallets) },
    {
      provide: ReconcileWalletUseCase,
      inject: [PostgresTransactionRunner, MikroOrmWalletRepository, InMemoryMetrics, StructuredLogger],
      useFactory: (transactions: PostgresTransactionRunner, wallets: MikroOrmWalletRepository, metrics: InMemoryMetrics, logger: StructuredLogger) =>
        new ReconcileWalletUseCase(transactions, wallets, metrics, logger),
    },
    { provide: GetWagerTransactionUseCase, inject: [MikroOrmWagerTransactionRepository], useFactory: (wagers: MikroOrmWagerTransactionRepository) => new GetWagerTransactionUseCase(wagers) },
    {
      provide: CreateWalletUseCase,
      inject: [PostgresTransactionRunner, MikroOrmWalletRepository, MikroOrmWagerTransactionRepository, MikroOrmOutboxRepository, RandomIdGenerator, SystemClock],
      useFactory: (transactions: PostgresTransactionRunner, wallets: MikroOrmWalletRepository, wagers: MikroOrmWagerTransactionRepository, outbox: MikroOrmOutboxRepository, ids: RandomIdGenerator, clock: SystemClock) =>
        new CreateWalletUseCase(transactions, wallets, wagers, outbox, ids, clock),
    },
    {
      provide: ProcessWagerUseCase,
      inject: [PostgresTransactionRunner, MikroOrmWalletRepository, MikroOrmWagerTransactionRepository, MikroOrmOutboxRepository, RandomIdGenerator, SystemClock, InMemoryMetrics, StructuredLogger],
      useFactory: (transactions: PostgresTransactionRunner, wallets: MikroOrmWalletRepository, wagers: MikroOrmWagerTransactionRepository, outbox: MikroOrmOutboxRepository, ids: RandomIdGenerator, clock: SystemClock, metrics: InMemoryMetrics, logger: StructuredLogger) =>
        new ProcessWagerUseCase(transactions, wallets, wagers, outbox, ids, clock, metrics, logger),
    },
    {
      provide: RuntimeWorkersService,
      inject: [PostgresTransactionRunner, MikroOrmInboxRepository, ProcessWagerUseCase, SystemClock, MikroOrmOutboxRepository, MikroOrmWalletRepository, MikroOrmWagerTransactionRepository, RandomIdGenerator, InMemoryMetrics],
      useFactory: async (
        transactions: PostgresTransactionRunner,
        inbox: MikroOrmInboxRepository,
        processWager: ProcessWagerUseCase,
        clock: SystemClock,
        outbox: MikroOrmOutboxRepository,
        wallets: MikroOrmWalletRepository,
        wagers: MikroOrmWagerTransactionRepository,
        ids: RandomIdGenerator,
        metrics: InMemoryMetrics,
      ) => {
        if (process.env.WORKERS_ENABLED !== 'true') return new RuntimeWorkersService();
        const sqs = new SQSClient({
          region: process.env.AWS_REGION ?? 'us-east-1',
          endpoint: process.env.SQS_ENDPOINT ?? 'http://127.0.0.1:4566',
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
          },
        });
        const queueUrl = async (name: string) => (await sqs.send(new GetQueueUrlCommand({ QueueName: name }))).QueueUrl!;
        const [wagerQueue, dlq, eventQueue] = await Promise.all([
          queueUrl('wager-transactions.fifo'),
          queueUrl('wager-transactions-dlq.fifo'),
          queueUrl('wager-events.fifo'),
        ]);
        const consume = new ConsumeWagerMessageUseCase(transactions, inbox, processWager, clock);
        const consumer = new WagerConsumerWorker(new AwsSqsClient(sqs, wagerQueue, dlq), consume, { maxReceiveCount: 3 }, metrics);
        const publish = new PublishOutboxBatchUseCase(
          transactions,
          outbox,
          new SqsOutboxEventPublisher(sqs, eventQueue),
          { baseRetryMs: 1_000, maxRetryMs: 60_000, leaseMs: 30_000 },
          metrics,
        );
        const publisher = new OutboxPublisherWorker(publish, clock, 250, 50);
        const reprocess = new ReprocessPendingReferencesUseCase(
          transactions,
          wallets,
          wagers,
          outbox,
          ids,
          { maxAttempts: 10, baseDelayMs: 1_000, maxDelayMs: 3_600_000, leaseMs: 30_000 },
          metrics,
        );
        return new RuntimeWorkersService(consumer, publisher, new PendingReferenceWorker(reprocess, clock, 1_000, 50), sqs);
      },
    },
  ],
})
export class AppModule {}
