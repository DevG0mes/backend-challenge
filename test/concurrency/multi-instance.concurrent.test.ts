import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ProcessHarness, wager } from '../support/process-harness';

const PLAYER = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4c1';
describe('three application instances', () => {
  const cluster = new ProcessHarness();
  beforeAll(async () => { await cluster.start(); await cluster.reset(); }, 30_000);
  afterAll(() => cluster.stop());
  test('all instances observe one shared idempotent outcome', async () => {
    const walletId = String((await cluster.createWallet(PLAYER)).id);
    const results = await Promise.all([0, 1, 2].map((instance) => cluster.postWager(instance, wager(walletId, PLAYER, 'shared', '40.00'), 'provider-a:shared')));
    expect(new Set(results.map((result) => result.body.transactionId)).size).toBe(1);
    expect(await cluster.scalar('select balance::text as value from wallets where id = ?', [walletId])).toBe('60.00');
    await cluster.assertWalletInvariant(walletId);
  }, 30_000);
});
