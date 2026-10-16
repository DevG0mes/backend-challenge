import { PostgreSqlDriver, type Options } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';

import { Migration202610150001 } from './migrations/Migration202610150001';
import { InboxMessageRecordSchema } from '../messaging/infrastructure/persistence/inbox-message.record';
import { OutboxMessageRecordSchema } from '../messaging/infrastructure/persistence/outbox-message.record';
import { WalletRecordSchema } from '../wallet/infrastructure/persistence/wallet.record';
import { LedgerEntryRecordSchema } from '../wallet/infrastructure/persistence/ledger-entry.record';
import { WagerTransactionRecordSchema } from '../wagering/infrastructure/persistence/wager-transaction.record';

export interface DatabaseConnectionOptions {
  host: string;
  port: number;
  dbName: string;
  user: string;
  password: string;
}

export function createMikroOrmConfig(connection?: DatabaseConnectionOptions): Options {
  return {
    driver: PostgreSqlDriver,
    host: connection?.host ?? process.env.POSTGRES_HOST ?? '127.0.0.1',
    port: connection?.port ?? Number(process.env.TEST_POSTGRES_PORT ?? process.env.POSTGRES_PORT ?? '5432'),
    dbName: connection?.dbName ?? process.env.POSTGRES_DB ?? 'wagering_core',
    user: connection?.user ?? process.env.POSTGRES_USER ?? 'dw_app',
    password: connection?.password ?? process.env.POSTGRES_PASSWORD ?? 'dw_local_N7v4K2p9',
    entities: [
      WalletRecordSchema,
      LedgerEntryRecordSchema,
      WagerTransactionRecordSchema,
      InboxMessageRecordSchema,
      OutboxMessageRecordSchema,
    ],
    extensions: [Migrator],
    migrations: {
      migrationsList: [Migration202610150001],
      transactional: true,
      allOrNothing: true,
      disableForeignKeys: false,
    },
  };
}

export default createMikroOrmConfig();
