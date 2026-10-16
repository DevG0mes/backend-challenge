export interface LoadTestConfig {
  baseUrls: string[];
  concurrency: number;
  distributedWallets: number;
  durationMs: number;
  warmupRequests: number;
  amount: string;
  initialBalance: string;
}

const positiveInteger = (value: string | undefined, fallback: number, name: string): number => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
};

const money = (value: string | undefined, fallback: string, name: string, allowZero = false): string => {
  const parsed = value ?? fallback;
  if (!/^(0|[1-9]\d*)\.\d{2}$/.test(parsed) || (!allowZero && /^0\.00$/.test(parsed))) {
    throw new Error(`${name} must be a positive decimal string with two places`);
  }
  return parsed;
};

export function parseLoadTestConfig(env: Record<string, string | undefined>): LoadTestConfig {
  const baseUrls = (env.LOAD_BASE_URLS ?? 'http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3002')
    .split(',').map((value) => value.trim()).filter(Boolean);
  if (baseUrls.length === 0) throw new Error('LOAD_BASE_URLS must contain at least one URL');
  for (const value of baseUrls) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('LOAD_BASE_URLS must use HTTP or HTTPS');
  }
  const durationSeconds = Number(env.LOAD_DURATION_SECONDS ?? '10');
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('LOAD_DURATION_SECONDS must be positive');
  return {
    baseUrls,
    concurrency: positiveInteger(env.LOAD_CONCURRENCY, 16, 'LOAD_CONCURRENCY'),
    distributedWallets: positiveInteger(env.LOAD_WALLETS, 20, 'LOAD_WALLETS'),
    durationMs: durationSeconds * 1_000,
    warmupRequests: positiveInteger(env.LOAD_WARMUP_REQUESTS, 10, 'LOAD_WARMUP_REQUESTS'),
    amount: money(env.LOAD_AMOUNT, '0.01', 'LOAD_AMOUNT'),
    initialBalance: money(env.LOAD_INITIAL_BALANCE, '1000000.00', 'LOAD_INITIAL_BALANCE'),
  };
}
