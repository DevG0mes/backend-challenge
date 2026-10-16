import { afterEach, describe, expect, test } from 'bun:test';

import { runScenario } from '../../../scripts/load-test/runner';

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });

function startFakeApi(consistent = true, failEveryThird = false) {
  let wallets = 0;
  let wagers = 0;
  const keys = new Set<string>();
  const server = Bun.serve({
    port: 0,
    routes: {
      '/wallets': { POST: () => Response.json({ id: `wallet-${++wallets}` }, { status: 201 }) },
      '/wallets/:id/reconciliation': { POST: () => Response.json({ consistent, checkedEntries: wagers }, { status: 201 }) },
      '/wagering/transactions': { POST: (request) => {
        wagers += 1;
        keys.add(request.headers.get('idempotency-key') ?? 'missing');
        if (failEveryThird && wagers % 3 === 0) return Response.json({ code: 'TRANSIENT' }, { status: 503 });
        return Response.json({ status: 'PROCESSED' }, { status: 201 });
      } },
    },
  });
  servers.push(server);
  return { url: `http://127.0.0.1:${server.port}`, stats: () => ({ wagers, uniqueKeys: keys.size }) };
}

describe('load scenario runner', () => {
  test('round-robins replicas, keeps unique identities, and counts non-2xx responses', async () => {
    const first = startFakeApi(true, true);
    const second = startFakeApi();
    const result = await runScenario({
      name: 'test', baseUrls: [first.url, second.url], concurrency: 2, durationMs: 100,
      walletCount: 2, warmupRequests: 2, amount: '0.01', initialBalance: '1000.00',
    });
    expect(first.stats().wagers).toBeGreaterThan(0);
    expect(second.stats().wagers).toBeGreaterThan(0);
    expect(first.stats().uniqueKeys + second.stats().uniqueKeys).toBe(first.stats().wagers + second.stats().wagers);
    expect(result.successfulRequests).toBeGreaterThan(0);
    expect(result.failedRequests).toBeGreaterThan(0);
    expect(result.reconciliation).toEqual({ checked: 2, inconsistent: 0 });
  });

  test('fails the scenario when reconciliation detects a mismatch', async () => {
    const api = startFakeApi(false);
    await expect(runScenario({
      name: 'mismatch', baseUrls: [api.url], concurrency: 1, durationMs: 20,
      walletCount: 1, warmupRequests: 1, amount: '0.01', initialBalance: '1000.00',
    })).rejects.toThrow('reconciliation mismatch');
  });
});
