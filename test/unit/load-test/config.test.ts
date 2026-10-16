import { describe, expect, test } from 'bun:test';

import { parseLoadTestConfig } from '../../../scripts/load-test/config';

describe('load test configuration', () => {
  test('provides safe defaults for the three Compose replicas', () => {
    expect(parseLoadTestConfig({})).toEqual({
      baseUrls: ['http://127.0.0.1:3000', 'http://127.0.0.1:3001', 'http://127.0.0.1:3002'],
      concurrency: 16,
      distributedWallets: 20,
      durationMs: 10_000,
      warmupRequests: 10,
      amount: '0.01',
      initialBalance: '1000000.00',
    });
  });

  test('parses explicit environment values', () => {
    expect(parseLoadTestConfig({
      LOAD_BASE_URLS: 'http://localhost:4100,http://localhost:4101,http://localhost:4102',
      LOAD_CONCURRENCY: '4', LOAD_WALLETS: '8', LOAD_DURATION_SECONDS: '2.5',
      LOAD_WARMUP_REQUESTS: '3', LOAD_AMOUNT: '1.25', LOAD_INITIAL_BALANCE: '5000.00',
    })).toMatchObject({ concurrency: 4, distributedWallets: 8, durationMs: 2_500, warmupRequests: 3, amount: '1.25', initialBalance: '5000.00' });
  });

  test.each([
    ['zero concurrency', { LOAD_CONCURRENCY: '0' }],
    ['zero duration', { LOAD_DURATION_SECONDS: '0' }],
    ['malformed URL', { LOAD_BASE_URLS: 'not-a-url' }],
    ['invalid money scale', { LOAD_AMOUNT: '1.2' }],
    ['zero amount', { LOAD_AMOUNT: '0.00' }],
  ])('rejects %s', (_, env) => expect(() => parseLoadTestConfig(env)).toThrow());
});
