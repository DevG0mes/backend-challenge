import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import { createMikroOrmConfig } from '../../../src/database/mikro-orm.config';
import { PostgresTransactionRunner } from '../../../src/database/postgres-transaction-runner';
import { Money } from '../../../src/shared/domain/money/money';
import { Wallet } from '../../../src/wallet/domain/wallet';
import { MikroOrmWalletRepository } from '../../../src/wallet/infrastructure/persistence/mikro-orm-wallet.repository';
import { WagerTransactionKind } from '../../../src/wagering/domain/wager-transaction';
import { WagerTransaction } from '../../../src/wagering/domain/wager-transaction';
import { MikroOrmWagerTransactionRepository } from '../../../src/wagering/infrastructure/persistence/mikro-orm-wager-transaction.repository';

const WALLET_ID = '0192f291-27dd-7d3f-8071-5f8685deef37';
const PLAYER_ID = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';
const TRANSACTION_ID = '0192f298-345e-7e38-af88-e43f851a819d';
const AT = new Date('2026-10-15T12:00:00.000Z');

describe('MikroORM repositories', () => {
  let orm: MikroORM;
  let transactions: PostgresTransactionRunner;
  let wallets: MikroOrmWalletRepository;
  let wagers: MikroOrmWagerTransactionRepository;

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
    transactions = new PostgresTransactionRunner(orm.em);
    wallets = new MikroOrmWalletRepository(orm.em);
    wagers = new MikroOrmWagerTransactionRepository(orm.em);
  });

  beforeEach(async () => {
    await orm.em.getConnection().execute(
      'truncate outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade',
    );
  });

  afterAll(async () => {
    await orm.close(true);
  });

  test('rolls back repository writes when transaction work throws', async () => {
    await expect(
      transactions.run(async (context) => {
        await wallets.save(openWallet(), context);
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    expect(await wallets.findById(WALLET_ID)).toBeNull();
  });

  test('persists and locks a wallet within one transaction', async () => {
    await transactions.run(async (context) => {
      await wallets.save(openWallet(), context);
    });

    await transactions.run(async (context) => {
      const locked = await wallets.findOneForUpdate(WALLET_ID, context);
      expect(locked?.balance.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
    });
  });

  test('finds wager transactions by every idempotency identity', async () => {
    await transactions.run(async (context) => {
      await wallets.save(openWallet(), context);
      await wagers.save(createWager(), context);
    });

    expect((await wagers.findById(TRANSACTION_ID))?.id).toBe(TRANSACTION_ID);
    expect((await wagers.findByIdempotencyKey('provider-a:external-1'))?.id).toBe(
      TRANSACTION_ID,
    );
    expect((await wagers.findByProviderExternal('provider-a', 'external-1'))?.id).toBe(
      TRANSACTION_ID,
    );
  });
});

function openWallet(): Wallet {
  return Wallet.open({
    id: WALLET_ID,
    playerId: PLAYER_ID,
    initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    createdAt: AT,
  });
}

function createWager(): WagerTransaction {
  return WagerTransaction.create({
    id: TRANSACTION_ID,
    providerId: 'provider-a',
    externalTransactionId: 'external-1',
    idempotencyKey: 'provider-a:external-1',
    payloadHash: 'a'.repeat(64),
    walletId: WALLET_ID,
    playerId: PLAYER_ID,
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '25.00', currency: 'BRL' }),
    referenceExternalTransactionId: undefined,
    createdAt: AT,
  });
}
