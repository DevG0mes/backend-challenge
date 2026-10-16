import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ProcessHarness, wager } from '../support/process-harness';

const PLAYER = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4d1';
describe('process crash recovery', () => {
  const cluster = new ProcessHarness();
  beforeAll(async () => { await cluster.start(); await cluster.reset(); }, 30_000);
  afterAll(() => cluster.stop());
  test('a committed request remains idempotent after its serving process stops', async () => {
    const walletId = String((await cluster.createWallet(PLAYER)).id);
    const first = await cluster.postWager(0, wager(walletId, PLAYER, 'crash-bet', '25.00'), 'provider-a:crash-bet');
    expect(first.status).toBe(201);
    cluster.stopInstance(0);
    const replay = await cluster.postWager(1, wager(walletId, PLAYER, 'crash-bet', '25.00'), 'provider-a:crash-bet');
    expect(replay.status).toBe(201);
    expect(replay.body.idempotentReplay).toBeTrue();
    expect(replay.body.transactionId).toBe(first.body.transactionId);
    expect(await cluster.scalar('select balance::text as value from wallets where id = ?', [walletId])).toBe('75.00');
    await cluster.assertWalletInvariant(walletId);
  }, 30_000);
});
