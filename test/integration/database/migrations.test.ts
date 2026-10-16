import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import { createMikroOrmConfig } from '../../../src/database/mikro-orm.config';

describe('database migrations', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(
      createMikroOrmConfig({
        host: '127.0.0.1',
        port: Number(process.env.TEST_POSTGRES_PORT ?? '55432'),
        dbName: 'wagering_core',
        user: 'dw_app',
        password: 'dw_local_N7v4K2p9',
      }),
    );
  });

  afterAll(async () => {
    await orm.close(true);
  });

  test('applies, reverts, and reapplies the complete schema', async () => {
    await orm.migrator.down({ to: 0 });
    await orm.migrator.up();

    const afterUp = await orm.em.getConnection().execute<{ table_name: string }[]>(
      `select table_name
         from information_schema.tables
        where table_schema = 'public'
          and table_name in (
            'wallets', 'wager_transactions', 'wallet_ledger_entries',
            'inbox_messages', 'outbox_messages'
          )
        order by table_name`,
    );

    expect(afterUp.map((row) => row.table_name)).toEqual([
      'inbox_messages',
      'outbox_messages',
      'wager_transactions',
      'wallet_ledger_entries',
      'wallets',
    ]);

    await orm.migrator.down({ to: 0 });
    const afterDown = await orm.em.getConnection().execute<{ count: string }[]>(
      `select count(*)::text as count
         from information_schema.tables
        where table_schema = 'public'
          and table_name = 'wallets'`,
    );
    expect(afterDown[0]?.count).toBe('0');

    await orm.migrator.up();
    const afterReapply = await orm.em.getConnection().execute<{ count: string }[]>(
      `select count(*)::text as count
         from information_schema.tables
        where table_schema = 'public'
          and table_name = 'wallets'`,
    );
    expect(afterReapply[0]?.count).toBe('1');
  });

  test('installs the required database constraints and immutable-ledger trigger', async () => {
    const constraints = await orm.em.getConnection().execute<{ conname: string }[]>(
      `select conname
         from pg_constraint
        where connamespace = 'public'::regnamespace
        order by conname`,
    );
    const names = constraints.map((row) => row.conname);

    expect(names).toContain('wallets_player_currency_unique');
    expect(names).toContain('wallets_balance_non_negative');
    expect(names).toContain('wallets_version_positive');
    expect(names).toContain('wager_transactions_idempotency_key_unique');
    expect(names).toContain('wager_transactions_provider_external_unique');
    expect(names).toContain('wallet_ledger_entries_wallet_transaction_unique');
    expect(names).toContain('inbox_messages_pkey');

    const triggers = await orm.em.getConnection().execute<{ tgname: string }[]>(
      `select tgname
         from pg_trigger
        where tgrelid = 'wallet_ledger_entries'::regclass
          and not tgisinternal`,
    );

    expect(triggers.map((row) => row.tgname)).toEqual(['wallet_ledger_entries_immutable']);
  });
});
