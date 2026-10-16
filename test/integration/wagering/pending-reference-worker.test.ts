import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import { createMikroOrmConfig } from '../../../src/database/mikro-orm.config';
import { PostgresTransactionRunner } from '../../../src/database/postgres-transaction-runner';
import { MikroOrmOutboxRepository } from '../../../src/messaging/infrastructure/persistence/mikro-orm-outbox.repository';
import { RandomIdGenerator } from '../../../src/shared/application/id-generator';
import { Money } from '../../../src/shared/domain/money/money';
import { CreateWalletUseCase } from '../../../src/wallet/application/create-wallet.use-case';
import { MikroOrmWalletRepository } from '../../../src/wallet/infrastructure/persistence/mikro-orm-wallet.repository';
import { ProcessWagerUseCase, type ProcessWagerCommand } from '../../../src/wagering/application/process-wager.use-case';
import { ReprocessPendingReferencesUseCase } from '../../../src/wagering/application/reprocess-pending-references.use-case';
import { WagerTransactionKind } from '../../../src/wagering/domain/wager-transaction';
import { MikroOrmWagerTransactionRepository } from '../../../src/wagering/infrastructure/persistence/mikro-orm-wager-transaction.repository';

const PLAYER_ID = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';
const NOW = new Date('2026-10-16T12:00:00.000Z');

describe('pending reference reprocessing', () => {
  let orm: MikroORM;
  let processWager: ProcessWagerUseCase;
  let reprocess: ReprocessPendingReferencesUseCase;
  let createWallet: CreateWalletUseCase;
  let walletId: string;

  beforeAll(async () => {
    orm = await MikroORM.init(createMikroOrmConfig({ host: '127.0.0.1', port: Number(process.env.TEST_POSTGRES_PORT ?? '55432'), dbName: 'wagering_core', user: 'dw_app', password: 'dw_local_N7v4K2p9' }));
    await orm.migrator.up();
    const transactions = new PostgresTransactionRunner(orm.em);
    const wallets = new MikroOrmWalletRepository(orm.em);
    const wagers = new MikroOrmWagerTransactionRepository(orm.em);
    const outbox = new MikroOrmOutboxRepository(orm.em);
    const ids = new RandomIdGenerator();
    const clock = { now: () => NOW };
    processWager = new ProcessWagerUseCase(transactions, wallets, wagers, outbox, ids, clock);
    createWallet = new CreateWalletUseCase(transactions, wallets, wagers, outbox, ids, clock);
    reprocess = new ReprocessPendingReferencesUseCase(transactions, wallets, wagers, outbox, ids, { maxAttempts: 10, baseDelayMs: 1_000, maxDelayMs: 3_600_000, leaseMs: 30_000 });
  });

  beforeEach(async () => {
    await orm.em.getConnection().execute('truncate outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade');
    walletId = (await createWallet.execute({ playerId: PLAYER_ID, initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }) })).id;
    await orm.em.getConnection().execute('truncate outbox_messages');
  });
  afterAll(async () => orm.close(true));

  test('converges a REFUND that arrived before its BET', async () => {
    await processWager.execute({ ...command('refund-1', WagerTransactionKind.Refund, '25.00'), referenceExternalTransactionId: 'bet-1' });
    await processWager.execute(command('bet-1', WagerTransactionKind.Bet, '25.00'));
    const result = await reprocess.execute(NOW, 10);
    expect(result).toEqual({ claimed: 1, processed: 1, rejected: 0, rescheduled: 0 });
    expect(await balance()).toBe('100.00');
    expect(await ledgerCount()).toBe('3');
  });

  test('converges a ROLLBACK that arrived before its WIN', async () => {
    await processWager.execute({ ...command('rollback-1', WagerTransactionKind.Rollback, '25.00'), referenceExternalTransactionId: 'win-1' });
    await processWager.execute(command('win-1', WagerTransactionKind.Win, '25.00'));
    await reprocess.execute(NOW, 10);
    expect(await balance()).toBe('100.00');
  });

  test('two workers settle one pending reversal only once', async () => {
    await processWager.execute({ ...command('refund-1', WagerTransactionKind.Refund, '25.00'), referenceExternalTransactionId: 'bet-1' });
    await processWager.execute(command('bet-1', WagerTransactionKind.Bet, '25.00'));
    const results = await Promise.all([reprocess.execute(NOW, 10), reprocess.execute(NOW, 10)]);
    expect(results.reduce((sum, result) => sum + result.processed, 0)).toBe(1);
    expect(await ledgerCount()).toBe('3');
  });

  test('rejects mismatched reference and exhausts a missing reference audibly', async () => {
    await processWager.execute({ ...command('refund-bad', WagerTransactionKind.Refund, '24.00'), referenceExternalTransactionId: 'bet-1' });
    await processWager.execute(command('bet-1', WagerTransactionKind.Bet, '25.00'));
    expect((await reprocess.execute(NOW, 10)).rejected).toBe(1);

    await processWager.execute({ ...command('refund-missing', WagerTransactionKind.Refund, '10.00'), referenceExternalTransactionId: 'never' });
    await orm.em.getConnection().execute("update wager_transactions set pending_attempts = 9 where external_transaction_id = 'refund-missing'");
    const exhausted = await reprocess.execute(NOW, 10);
    expect(exhausted.rejected).toBe(1);
    const row = await orm.em.getConnection().execute<{ failure_code: string }[]>("select failure_code from wager_transactions where external_transaction_id = 'refund-missing'");
    expect(row[0]?.failure_code).toBe('REFERENCE_NOT_FOUND');
    const events = await orm.em.getConnection().execute<{ event_type: string }[]>("select event_type from outbox_messages where payload->'data'->>'transactionId' = (select id::text from wager_transactions where external_transaction_id = 'refund-missing')");
    expect(events.map((event) => event.event_type)).toContain('WagerRejected');
  });

  function command(externalTransactionId: string, kind: WagerTransactionKind, amount: string): ProcessWagerCommand {
    return { providerId: 'provider-a', externalTransactionId, idempotencyKey: `provider-a:${externalTransactionId}`, playerId: PLAYER_ID, walletId, roundId: 'round-1', gameId: 'game-1', kind, money: Money.from({ amount, currency: 'BRL' }), referenceExternalTransactionId: undefined };
  }
  async function balance(): Promise<string> { return (await orm.em.getConnection().execute<{ balance: string }[]>('select balance from wallets where id = ?', [walletId]))[0]!.balance; }
  async function ledgerCount(): Promise<string> { return (await orm.em.getConnection().execute<{ count: string }[]>('select count(*)::text as count from wallet_ledger_entries'))[0]!.count; }
});
