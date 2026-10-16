import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ProcessHarness, wager } from '../support/process-harness';

const PLAYER = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';
describe('multi-process idempotency', () => {
  const cluster = new ProcessHarness();
  beforeAll(async () => { await cluster.start(); await cluster.reset(); }, 30_000);
  afterAll(() => cluster.stop());

  test('50 identical bets across three processes produce one debit', async () => {
    const wallet = await cluster.createWallet(PLAYER);
    const walletId = String(wallet.id);
    const results = await Promise.all(Array.from({ length: 50 }, (_, index) =>
      cluster.postWager(index % 3, wager(walletId, PLAYER, 'same-bet', '25.00'), 'provider-a:same-bet')));
    expect(results.every((result) => result.status === 201)).toBeTrue();
    expect(results.filter((result) => result.body.idempotentReplay === false)).toHaveLength(1);
    expect(await cluster.scalar('select count(*)::text as value from wallet_ledger_entries where wallet_id = ?', [walletId])).toBe('2');
    expect(await cluster.scalar('select balance::text as value from wallets where id = ?', [walletId])).toBe('75.00');
    await cluster.assertWalletInvariant(walletId);
  }, 30_000);
});
