import { Module } from '@nestjs/common';
import { MikroORM as CoreMikroORM } from '@mikro-orm/core';
import type { MikroORM } from '@mikro-orm/postgresql';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import mikroOrmConfig from './database/mikro-orm.config';
import { PostgresTransactionRunner } from './database/postgres-transaction-runner';
import { HealthController } from './health/health.controller';
import { SystemClock } from './shared/application/clock';
import { RandomIdGenerator } from './shared/application/id-generator';
import { DomainExceptionFilter } from './shared/interface/http/domain-exception.filter';
import { CreateWalletUseCase } from './wallet/application/create-wallet.use-case';
import { WalletController } from './wallet/interface/http/wallet.controller';
import { MikroOrmWalletRepository } from './wallet/infrastructure/persistence/mikro-orm-wallet.repository';
import { ProcessWagerUseCase } from './wagering/application/process-wager.use-case';
import { WageringController } from './wagering/interface/http/wagering.controller';
import { MikroOrmWagerTransactionRepository } from './wagering/infrastructure/persistence/mikro-orm-wager-transaction.repository';

@Module({
  imports: [MikroOrmModule.forRoot(mikroOrmConfig)],
  controllers: [HealthController, WalletController, WageringController],
  providers: [
    DomainExceptionFilter,
    SystemClock,
    RandomIdGenerator,
    { provide: PostgresTransactionRunner, inject: [CoreMikroORM], useFactory: (orm: MikroORM) => new PostgresTransactionRunner(orm.em) },
    { provide: MikroOrmWalletRepository, inject: [CoreMikroORM], useFactory: (orm: MikroORM) => new MikroOrmWalletRepository(orm.em) },
    { provide: MikroOrmWagerTransactionRepository, inject: [CoreMikroORM], useFactory: (orm: MikroORM) => new MikroOrmWagerTransactionRepository(orm.em) },
    {
      provide: CreateWalletUseCase,
      inject: [PostgresTransactionRunner, MikroOrmWalletRepository, MikroOrmWagerTransactionRepository, RandomIdGenerator, SystemClock],
      useFactory: (transactions: PostgresTransactionRunner, wallets: MikroOrmWalletRepository, wagers: MikroOrmWagerTransactionRepository, ids: RandomIdGenerator, clock: SystemClock) =>
        new CreateWalletUseCase(transactions, wallets, wagers, ids, clock),
    },
    {
      provide: ProcessWagerUseCase,
      inject: [PostgresTransactionRunner, MikroOrmWalletRepository, MikroOrmWagerTransactionRepository, RandomIdGenerator, SystemClock],
      useFactory: (transactions: PostgresTransactionRunner, wallets: MikroOrmWalletRepository, wagers: MikroOrmWagerTransactionRepository, ids: RandomIdGenerator, clock: SystemClock) =>
        new ProcessWagerUseCase(transactions, wallets, wagers, ids, clock),
    },
  ],
})
export class AppModule {}
