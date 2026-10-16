import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ProcessHarness, wager } from '../support/process-harness';

const PLAYER = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a2';
describe('competing bets', () => {
  const cluster = new ProcessHarness();
  beforeAll(async () => { await cluster.start(); await cluster.reset(); }, 30_000);
  afterAll(() => cluster.stop());
  test('two BRL 80 bets against BRL 100 allow exactly one', async () => {
    const walletId = String((await cluster.createWallet(PLAYER)).id);
    const results = await Promise.all([
      cluster.postWager(0, wager(walletId, PLAYER, 'bet-a', '80.00'), 'provider-a:bet-a'),
      cluster.postWager(1, wager(walletId, PLAYER, 'bet-b', '80.00'), 'provider-a:bet-b'),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 422]);
    expect(await cluster.scalar("select count(*)::text as value from wager_transactions where status = 'PROCESSED' and kind = 'BET'")).toBe('1');
    expect(await cluster.scalar("select count(*)::text as value from wager_transactions where status = 'REJECTED' and failure_code = 'INSUFFICIENT_FUNDS'")).toBe('1');
    expect(await cluster.scalar('select balance::text as value from wallets where id = ?', [walletId])).toBe('20.00');
    await cluster.assertWalletInvariant(walletId);
  }, 30_000);
});
