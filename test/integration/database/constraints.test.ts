import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import { createMikroOrmConfig } from '../../../src/database/mikro-orm.config';

const WALLET_ID = '0192f291-27dd-7d3f-8071-5f8685deef37';
const PLAYER_ID = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';
const TRANSACTION_ID = '0192f298-345e-7e38-af88-e43f851a819d';
const HASH = 'a'.repeat(64);

describe('database constraints', () => {
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
    await orm.migrator.up();
  });

  beforeEach(async () => {
    await orm.em.getConnection().execute(
      'truncate outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade',
    );
  });

  afterAll(async () => {
    await orm.close(true);
  });

  test('keeps exact high-value decimals as strings', async () => {
    await insertWallet(orm, {
      balance: '99999999999999999999999999999999999999.99',
    });

    const rows = await orm.em.getConnection().execute<{ balance: string }[]>(
      'select balance from wallets where id = ?',
      [WALLET_ID],
    );

    expect(rows[0]?.balance).toBe('99999999999999999999999999999999999999.99');
    expect(typeof rows[0]?.balance).toBe('string');
  });

  test('rejects duplicate player/currency wallets', async () => {
    await insertWallet(orm);

    expect(
      insertWallet(orm, { id: '0192f291-27dd-7d3f-8071-5f8685deef38' }),
    ).rejects.toThrow();
  });

  test('rejects negative wallet balance', async () => {
    expect(insertWallet(orm, { balance: '-0.01' })).rejects.toThrow();
  });

  test('rejects duplicate provider transaction and duplicate idempotency key', async () => {
    await insertWallet(orm);
    await insertTransaction(orm);

    expect(
      insertTransaction(orm, {
        id: '0192f298-345e-7e38-af88-e43f851a819e',
        idempotencyKey: 'provider-a:another-key',
      }),
    ).rejects.toThrow();

    expect(
      insertTransaction(orm, {
        id: '0192f298-345e-7e38-af88-e43f851a819f',
        externalTransactionId: 'another-external-id',
      }),
    ).rejects.toThrow();
  });

  test('rejects duplicate ledger entries for one wallet transaction', async () => {
    await insertWallet(orm);
    await insertTransaction(orm);
    await insertLedger(orm);

    expect(
      insertLedger(orm, { id: '0192f299-345e-7e38-af88-e43f851a819f' }),
    ).rejects.toThrow();
  });

  test('rejects UPDATE and DELETE of committed ledger entries', async () => {
    await insertWallet(orm);
    await insertTransaction(orm);
    await insertLedger(orm);

    expect(
      orm.em
        .getConnection()
        .execute('update wallet_ledger_entries set amount = ? where transaction_id = ?', [
          '10.00',
          TRANSACTION_ID,
        ]),
    ).rejects.toThrow('wallet ledger entries are immutable');

    expect(
      orm.em
        .getConnection()
        .execute('delete from wallet_ledger_entries where transaction_id = ?', [TRANSACTION_ID]),
    ).rejects.toThrow('wallet ledger entries are immutable');
  });

  test('deduplicates inbox messages by consumer and message ID', async () => {
    const sql = `insert into inbox_messages
      (consumer_name, message_id, payload_hash, received_at)
      values (?, ?, ?, now())`;
    await orm.em.getConnection().execute(sql, ['wager-consumer', 'message-1', HASH]);

    expect(
      orm.em.getConnection().execute(sql, ['wager-consumer', 'message-1', HASH]),
    ).rejects.toThrow();

    await orm.em.getConnection().execute(sql, ['another-consumer', 'message-1', HASH]);
  });
});

async function insertWallet(
  orm: MikroORM,
  override: { id?: string; balance?: string } = {},
): Promise<void> {
  await orm.em.getConnection().execute(
    `insert into wallets
      (id, player_id, currency, balance, version, created_at, updated_at)
     values (?, ?, 'BRL', ?, 1, now(), now())`,
    [override.id ?? WALLET_ID, PLAYER_ID, override.balance ?? '100.00'],
  );
}

async function insertTransaction(
  orm: MikroORM,
  override: { id?: string; externalTransactionId?: string; idempotencyKey?: string } = {},
): Promise<void> {
  await orm.em.getConnection().execute(
    `insert into wager_transactions
      (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
       wallet_id, player_id, round_id, game_id, kind, amount, currency, status, created_at)
     values (?, 'provider-a', ?, ?, ?, ?, ?, 'round-1', 'game-1', 'BET',
             '25.00', 'BRL', 'PENDING', now())`,
    [
      override.id ?? TRANSACTION_ID,
      override.externalTransactionId ?? 'external-1',
      override.idempotencyKey ?? 'provider-a:external-1',
      HASH,
      WALLET_ID,
      PLAYER_ID,
    ],
  );
}

async function insertLedger(
  orm: MikroORM,
  override: { id?: string } = {},
): Promise<void> {
  await orm.em.getConnection().execute(
    `insert into wallet_ledger_entries
      (id, wallet_id, transaction_id, direction, amount, currency,
       balance_before, balance_after, created_at)
     values (?, ?, ?, 'DEBIT', '25.00', 'BRL', '100.00', '75.00', now())`,
    [override.id ?? '0192f299-345e-7e38-af88-e43f851a819e', WALLET_ID, TRANSACTION_ID],
  );
}
