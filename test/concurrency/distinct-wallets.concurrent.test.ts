import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ProcessHarness, wager } from '../support/process-harness';

describe('distinct wallet concurrency', () => {
  const cluster = new ProcessHarness();
  beforeAll(async () => { await cluster.start(); await cluster.reset(); }, 30_000);
  afterAll(() => cluster.stop());
  test('independent wallets make concurrent progress', async () => {
    const players = ['0192f28f-5dc0-7d58-bdb2-814ad6a0f4b1', '0192f28f-5dc0-7d58-bdb2-814ad6a0f4b2', '0192f28f-5dc0-7d58-bdb2-814ad6a0f4b3'];
    const walletIds = await Promise.all(players.map(async (player, index) => String((await cluster.createWallet(player, '100.00', index)).id)));
    const results = await Promise.all(walletIds.map((walletId, index) => cluster.postWager(index, wager(walletId, players[index]!, `bet-${index}`, '30.00'), `provider-a:bet-${index}`)));
    expect(results.every((result) => result.status === 201)).toBeTrue();
    for (const walletId of walletIds) {
      expect(await cluster.scalar('select balance::text as value from wallets where id = ?', [walletId])).toBe('70.00');
      await cluster.assertWalletInvariant(walletId);
    }
  }, 30_000);
});
