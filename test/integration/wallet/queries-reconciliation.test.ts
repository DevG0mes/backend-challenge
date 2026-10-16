import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import { createMikroOrmConfig } from '../../../src/database/mikro-orm.config';
import { PostgresTransactionRunner } from '../../../src/database/postgres-transaction-runner';
import { MikroOrmOutboxRepository } from '../../../src/messaging/infrastructure/persistence/mikro-orm-outbox.repository';
import { RandomIdGenerator } from '../../../src/shared/application/id-generator';
import { Money } from '../../../src/shared/domain/money/money';
import { CreateWalletUseCase } from '../../../src/wallet/application/create-wallet.use-case';
import { GetWalletUseCase } from '../../../src/wallet/application/get-wallet.use-case';
import { ListLedgerUseCase } from '../../../src/wallet/application/list-ledger.use-case';
import { ReconcileWalletUseCase } from '../../../src/wallet/application/reconcile-wallet.use-case';
import { MikroOrmWalletRepository } from '../../../src/wallet/infrastructure/persistence/mikro-orm-wallet.repository';
import { GetWagerTransactionUseCase } from '../../../src/wagering/application/get-wager-transaction.use-case';
import { ProcessWagerUseCase } from '../../../src/wagering/application/process-wager.use-case';
import { WagerTransactionKind } from '../../../src/wagering/domain/wager-transaction';
import { MikroOrmWagerTransactionRepository } from '../../../src/wagering/infrastructure/persistence/mikro-orm-wager-transaction.repository';
import { InMemoryMetrics } from '../../../src/shared/observability/metrics';

const PLAYER_ID = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';
const NOW = new Date('2026-10-16T12:00:00.000Z');

describe('wallet queries and reconciliation', () => {
  let orm: MikroORM;
  let createWallet: CreateWalletUseCase;
  let processWager: ProcessWagerUseCase;
  let getWallet: GetWalletUseCase;
  let listLedger: ListLedgerUseCase;
  let reconcile: ReconcileWalletUseCase;
  let getTransaction: GetWagerTransactionUseCase;
  let metrics: InMemoryMetrics;

  beforeAll(async () => {
    orm = await MikroORM.init(createMikroOrmConfig({ host: '127.0.0.1', port: Number(process.env.TEST_POSTGRES_PORT ?? '55432'), dbName: 'wagering', user: 'wagering', password: 'wagering' }));
    await orm.migrator.up();
    const runner = new PostgresTransactionRunner(orm.em);
    const wallets = new MikroOrmWalletRepository(orm.em);
    const wagers = new MikroOrmWagerTransactionRepository(orm.em);
    const outbox = new MikroOrmOutboxRepository(orm.em);
    const ids = new RandomIdGenerator();
    const clock = { now: () => NOW };
    createWallet = new CreateWalletUseCase(runner, wallets, wagers, outbox, ids, clock);
    processWager = new ProcessWagerUseCase(runner, wallets, wagers, outbox, ids, clock);
    getWallet = new GetWalletUseCase(wallets);
    listLedger = new ListLedgerUseCase(wallets);
    metrics = new InMemoryMetrics();
    reconcile = new ReconcileWalletUseCase(wallets, metrics);
    getTransaction = new GetWagerTransactionUseCase(wagers);
  });

  beforeEach(async () => {
    await orm.em.getConnection().execute('truncate outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade');
  });
  afterAll(async () => orm.close(true));

  test('returns wallet details and pages equal-timestamp entries with an opaque stable cursor', async () => {
    const wallet = await createWallet.execute({ playerId: PLAYER_ID, initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }) });
    await submitWager(wallet.id, 'bet-1', WagerTransactionKind.Bet, '10.00');
    await submitWager(wallet.id, 'win-1', WagerTransactionKind.Win, '5.00');

    expect(await getWallet.execute(wallet.id)).toMatchObject({ id: wallet.id, playerId: PLAYER_ID, balance: { amount: '95.00', currency: 'BRL' }, version: 3 });
    const first = await listLedger.execute(wallet.id, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeString();
    expect(first.nextCursor).not.toContain(first.items[1]!.id);
    const second = await listLedger.execute(wallet.id, { limit: 2, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(3);
    expect(second.nextCursor).toBeUndefined();
  });

  test('reconstructs large fractional balances exactly and signals mismatch without repair', async () => {
    const wallet = await createWallet.execute({ playerId: PLAYER_ID, initialBalance: Money.from({ amount: '99999999999999999999999999999999999999.99', currency: 'BRL' }) });
    const consistent = await reconcile.execute(wallet.id);
    expect(consistent).toMatchObject({ consistent: true, checkedEntries: 1, difference: { amount: '0.00', currency: 'BRL' } });

    await orm.em.getConnection().execute('update wallets set balance = ? where id = ?', ['1.00', wallet.id]);
    const mismatch = await reconcile.execute(wallet.id);
    expect(mismatch.consistent).toBeFalse();
    expect(metrics.counter('wallet_reconciliation_mismatches_total')).toBe(1);
    expect(metrics.counter('wallet_reconciliations_total', { consistent: 'false' })).toBe(1);
    expect(mismatch.calculatedBalance.amount).toBe('99999999999999999999999999999999999999.99');
    expect((await getWallet.execute(wallet.id)).balance.amount).toBe('1.00');
  });

  test('looks up one transaction by internal id or provider identity', async () => {
    const wallet = await createWallet.execute({ playerId: PLAYER_ID, initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }) });
    const processed = await submitWager(wallet.id, 'bet-lookup', WagerTransactionKind.Bet, '10.00');
    const byId = await getTransaction.byId(processed.transactionId);
    const byProvider = await getTransaction.byProviderExternal('provider-a', 'bet-lookup');
    expect(byProvider).toEqual(byId);
    expect(byId).toMatchObject({ id: processed.transactionId, externalTransactionId: 'bet-lookup', status: 'PROCESSED', money: { amount: '10.00', currency: 'BRL' } });
  });

  function submitWager(walletId: string, externalTransactionId: string, kind: WagerTransactionKind, amount: string) {
    return processWager.execute({ providerId: 'provider-a', externalTransactionId, idempotencyKey: `provider-a:${externalTransactionId}`, playerId: PLAYER_ID, walletId, roundId: 'round-1', gameId: 'game-1', kind, money: Money.from({ amount, currency: 'BRL' }), referenceExternalTransactionId: undefined });
  }
});
