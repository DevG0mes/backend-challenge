import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import { createMikroOrmConfig } from '../../../src/database/mikro-orm.config';
import { PostgresTransactionRunner } from '../../../src/database/postgres-transaction-runner';
import type { Clock } from '../../../src/shared/application/clock';
import { RandomIdGenerator } from '../../../src/shared/application/id-generator';
import { Money } from '../../../src/shared/domain/money/money';
import { CreateWalletUseCase } from '../../../src/wallet/application/create-wallet.use-case';
import { MikroOrmWalletRepository } from '../../../src/wallet/infrastructure/persistence/mikro-orm-wallet.repository';
import {
  ProcessWagerUseCase,
  type ProcessWagerCommand,
} from '../../../src/wagering/application/process-wager.use-case';
import { WagerTransactionKind, WagerTransactionStatus } from '../../../src/wagering/domain/wager-transaction';
import { MikroOrmWagerTransactionRepository } from '../../../src/wagering/infrastructure/persistence/mikro-orm-wager-transaction.repository';
import { MikroOrmOutboxRepository } from '../../../src/messaging/infrastructure/persistence/mikro-orm-outbox.repository';
import { InMemoryMetrics } from '../../../src/shared/observability/metrics';

const PLAYER_ID = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';
const NOW = new Date('2026-10-15T12:00:00.000Z');
const clock: Clock = { now: () => NOW };

describe('ProcessWagerUseCase', () => {
  let orm: MikroORM;
  let processWager: ProcessWagerUseCase;
  let createWallet: CreateWalletUseCase;
  let walletId: string;
  let metrics: InMemoryMetrics;

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
    const transactions = new PostgresTransactionRunner(orm.em);
    const wallets = new MikroOrmWalletRepository(orm.em);
    const wagers = new MikroOrmWagerTransactionRepository(orm.em);
    const ids = new RandomIdGenerator();
    const outbox = new MikroOrmOutboxRepository(orm.em);
    createWallet = new CreateWalletUseCase(transactions, wallets, wagers, outbox, ids, clock);
    metrics = new InMemoryMetrics();
    processWager = new ProcessWagerUseCase(transactions, wallets, wagers, outbox, ids, clock, metrics);
  });

  beforeEach(async () => {
    await orm.em.getConnection().execute(
      'truncate outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade',
    );
    walletId = (
      await createWallet.execute({
        playerId: PLAYER_ID,
        initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      })
    ).id;
    await orm.em.getConnection().execute('truncate outbox_messages');
  });

  afterAll(async () => {
    await orm.close(true);
  });

  test.each([
    [WagerTransactionKind.Bet, '25.00', '75.00', 2],
    [WagerTransactionKind.Win, '25.00', '125.00', 2],
    [WagerTransactionKind.Loss, '25.00', '100.00', 1],
  ])('processes %s atomically', async (kind, amount, expectedBalance, expectedLedgerCount) => {
    const result = await processWager.execute(command('transaction-1', kind, amount));

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toEqual({ amount: expectedBalance, currency: 'BRL' });
    expect(result.idempotentReplay).toBeFalse();
    expect(await count('wallet_ledger_entries')).toBe(String(expectedLedgerCount));
  });

  test('processes REFUND after its BET and restores the balance', async () => {
    await processWager.execute(command('bet-1', WagerTransactionKind.Bet, '25.00'));

    const result = await processWager.execute({
      ...command('refund-1', WagerTransactionKind.Refund, '25.00'),
      referenceExternalTransactionId: 'bet-1',
    });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance.amount).toBe('100.00');
    expect(await count('wallet_ledger_entries')).toBe('3');
  });

  test('processes ROLLBACK after WIN and restores the balance', async () => {
    await processWager.execute(command('win-1', WagerTransactionKind.Win, '25.00'));

    const result = await processWager.execute({
      ...command('rollback-1', WagerTransactionKind.Rollback, '25.00'),
      referenceExternalTransactionId: 'win-1',
    });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance.amount).toBe('100.00');
  });

  test('persists an out-of-order reversal as pending reference', async () => {
    const result = await processWager.execute({
      ...command('refund-1', WagerTransactionKind.Refund, '25.00'),
      referenceExternalTransactionId: 'missing-bet',
    });

    expect(result.status).toBe(WagerTransactionStatus.PendingReference);
    expect(result.balance.amount).toBe('100.00');
    expect(await count('wallet_ledger_entries')).toBe('1');
  });

  test('commits insufficient funds as an auditable rejection', async () => {
    const result = await processWager.execute(
      command('too-large', WagerTransactionKind.Bet, '100.01'),
    );

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(result.balance.amount).toBe('100.00');
    expect(await count('wager_transactions')).toBe('2');
    expect(await count('wallet_ledger_entries')).toBe('1');
    expect(await outboxTypes()).toEqual(['WagerRejected']);
  });

  test('atomically queues processed and balance-changed events', async () => {
    await processWager.execute(command('event-bet', WagerTransactionKind.Bet, '25.00'));
    expect(await outboxTypes()).toEqual(['WagerProcessed', 'WalletBalanceChanged']);
  });

  test('returns the original observed balance on idempotent replay', async () => {
    const duplicatesBefore = metrics.counter('wager_duplicates_total');
    const original = command('bet-1', WagerTransactionKind.Bet, '25.00');
    const first = await processWager.execute(original);
    await processWager.execute(command('win-1', WagerTransactionKind.Win, '10.00'));

    const replay = await processWager.execute(original);

    expect(first.balance.amount).toBe('75.00');
    expect(replay.balance.amount).toBe('75.00');
    expect(replay.transactionId).toBe(first.transactionId);
    expect(replay.idempotentReplay).toBeTrue();
    expect(metrics.counter('wager_duplicates_total')).toBe(duplicatesBefore + 1);
    expect(metrics.counter('wager_transactions_total', { status: 'PROCESSED', kind: 'BET' })).toBeGreaterThan(0);
    expect(metrics.histogram('wager_processing_latency_ms', { kind: 'BET' }).length).toBeGreaterThan(0);
    expect(metrics.histogram('wallet_lock_wait_ms').length).toBeGreaterThan(0);
    expect(await count('wallet_ledger_entries')).toBe('3');
  });

  test('rejects the same idempotency key with a divergent business payload', async () => {
    await processWager.execute(command('bet-1', WagerTransactionKind.Bet, '25.00'));

    await expect(
      processWager.execute({
        ...command('bet-1', WagerTransactionKind.Bet, '26.00'),
        idempotencyKey: 'provider-a:bet-1',
      }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    expect(await count('wallet_ledger_entries')).toBe('2');
  });

  test('settles simultaneous first delivery as one financial effect', async () => {
    const request = command('parallel-bet', WagerTransactionKind.Bet, '25.00');
    const results = await Promise.all(
      Array.from({ length: 10 }, () => processWager.execute(request)),
    );

    expect(results.filter((result) => !result.idempotentReplay)).toHaveLength(1);
    expect(results.filter((result) => result.idempotentReplay)).toHaveLength(9);
    expect(await count('wallet_ledger_entries')).toBe('2');
    const balances = await orm.em.getConnection().execute<{ balance: string }[]>(
      'select balance from wallets where id = ?',
      [walletId],
    );
    expect(balances[0]?.balance).toBe('75.00');
  });

  function command(
    externalTransactionId: string,
    kind: WagerTransactionKind,
    amount: string,
  ): ProcessWagerCommand {
    return {
      providerId: 'provider-a',
      externalTransactionId,
      idempotencyKey: `provider-a:${externalTransactionId}`,
      playerId: PLAYER_ID,
      walletId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind,
      money: Money.from({ amount, currency: 'BRL' }),
      referenceExternalTransactionId: undefined,
    };
  }

  async function count(table: string): Promise<string> {
    const rows = await orm.em
      .getConnection()
      .execute<{ count: string }[]>(`select count(*)::text as count from ${table}`);
    return rows[0]?.count ?? 'missing';
  }

  async function outboxTypes(): Promise<string[]> {
    const rows = await orm.em.getConnection().execute<{ event_type: string }[]>(
      'select event_type from outbox_messages order by occurred_at, event_type',
    );
    return rows.map((row) => row.event_type);
  }
});
