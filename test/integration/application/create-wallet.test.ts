import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import { createMikroOrmConfig } from '../../../src/database/mikro-orm.config';
import { PostgresTransactionRunner } from '../../../src/database/postgres-transaction-runner';
import type { Clock } from '../../../src/shared/application/clock';
import type { IdGenerator } from '../../../src/shared/application/id-generator';
import { Money } from '../../../src/shared/domain/money/money';
import { CreateWalletUseCase } from '../../../src/wallet/application/create-wallet.use-case';
import { MikroOrmWalletRepository } from '../../../src/wallet/infrastructure/persistence/mikro-orm-wallet.repository';
import { MikroOrmWagerTransactionRepository } from '../../../src/wagering/infrastructure/persistence/mikro-orm-wager-transaction.repository';

const PLAYER_ID = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';
const WALLET_ID = '0192f291-27dd-7d3f-8071-5f8685deef37';
const OPENING_ID = '0192f298-345e-7e38-af88-e43f851a819d';
const LEDGER_ID = '0192f299-345e-7e38-af88-e43f851a819e';
const NOW = new Date('2026-10-15T12:00:00.000Z');

describe('CreateWalletUseCase', () => {
  let orm: MikroORM;
  let wallets: MikroOrmWalletRepository;
  let wagers: MikroOrmWagerTransactionRepository;
  let transactions: PostgresTransactionRunner;

  beforeAll(async () => {
    orm = await MikroORM.init(
      createMikroOrmConfig({
        host: '127.0.0.1',
        port: Number(process.env.TEST_POSTGRES_PORT ?? '55432'),
        dbName: 'wagering',
        user: 'wagering',
        password: 'wagering',
      }),
    );
    await orm.migrator.up();
    wallets = new MikroOrmWalletRepository(orm.em);
    wagers = new MikroOrmWagerTransactionRepository(orm.em);
    transactions = new PostgresTransactionRunner(orm.em);
  });

  beforeEach(async () => {
    await orm.em.getConnection().execute(
      'truncate outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade',
    );
  });

  afterAll(async () => {
    await orm.close(true);
  });

  test('atomically creates wallet, OPENING transaction, and credit ledger', async () => {
    const useCase = createUseCase([WALLET_ID, OPENING_ID, LEDGER_ID]);

    const result = await useCase.execute({
      playerId: PLAYER_ID,
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });

    expect(result).toEqual({
      id: WALLET_ID,
      playerId: PLAYER_ID,
      balance: { amount: '100.00', currency: 'BRL' },
      version: 1,
    });
    expect(await count('wallets')).toBe('1');
    expect(await count('wager_transactions')).toBe('1');
    expect(await count('wallet_ledger_entries')).toBe('1');

    const opening = await orm.em.getConnection().execute<
      { kind: string; status: string; amount: string }[]
    >('select kind, status, amount from wager_transactions');
    expect(opening[0]).toEqual({ kind: 'OPENING', status: 'PROCESSED', amount: '100.00' });
  });

  test('creates a zero wallet without OPENING or ledger movement', async () => {
    const useCase = createUseCase([WALLET_ID]);

    await useCase.execute({
      playerId: PLAYER_ID,
      initialBalance: Money.zero('BRL'),
    });

    expect(await count('wallets')).toBe('1');
    expect(await count('wager_transactions')).toBe('0');
    expect(await count('wallet_ledger_entries')).toBe('0');
  });

  test('rejects a second wallet for the same player and currency', async () => {
    await createUseCase([WALLET_ID]).execute({
      playerId: PLAYER_ID,
      initialBalance: Money.zero('BRL'),
    });

    await expect(
      createUseCase(['0192f291-27dd-7d3f-8071-5f8685deef38']).execute({
        playerId: PLAYER_ID,
        initialBalance: Money.zero('BRL'),
      }),
    ).rejects.toThrow();
    expect(await count('wallets')).toBe('1');
  });

  test('rolls back wallet and OPENING when ledger persistence fails', async () => {
    const useCase = createUseCase([WALLET_ID, OPENING_ID, 'not-a-uuid']);

    await expect(
      useCase.execute({
        playerId: PLAYER_ID,
        initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      }),
    ).rejects.toThrow();

    expect(await count('wallets')).toBe('0');
    expect(await count('wager_transactions')).toBe('0');
    expect(await count('wallet_ledger_entries')).toBe('0');
  });

  function createUseCase(ids: string[]): CreateWalletUseCase {
    return new CreateWalletUseCase(
      transactions,
      wallets,
      wagers,
      new SequenceIdGenerator(ids),
      { now: () => NOW },
    );
  }

  async function count(table: string): Promise<string> {
    const rows = await orm.em
      .getConnection()
      .execute<{ count: string }[]>(`select count(*)::text as count from ${table}`);
    return rows[0]?.count ?? 'missing';
  }
});

class SequenceIdGenerator implements IdGenerator {
  constructor(private readonly ids: string[]) {}

  next(): string {
    const id = this.ids.shift();
    if (id === undefined) throw new Error('No deterministic ID configured');
    return id;
  }
}

const _clockTypeCheck: Clock = { now: () => NOW };
void _clockTypeCheck;
