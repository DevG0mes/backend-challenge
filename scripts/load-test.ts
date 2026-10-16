import { mkdir } from 'node:fs/promises';

import { parseLoadTestConfig } from './load-test/config';
import { runScenario } from './load-test/runner';

const config = parseLoadTestConfig(process.env);
const common = {
  baseUrls: config.baseUrls,
  concurrency: config.concurrency,
  durationMs: config.durationMs,
  warmupRequests: config.warmupRequests,
  amount: config.amount,
  initialBalance: config.initialBalance,
};

console.log('Running distributed-wallet load scenario...');
const distributed = await runScenario({ ...common, name: 'distributed', walletCount: config.distributedWallets });
console.log(`distributed: ${distributed.requestsPerSecond.toFixed(2)} req/s, p95=${distributed.p95Ms.toFixed(2)}ms, errors=${distributed.failedRequests}`);

console.log('Running hot-wallet load scenario...');
const hotWallet = await runScenario({ ...common, name: 'hot-wallet', walletCount: 1 });
console.log(`hot-wallet: ${hotWallet.requestsPerSecond.toFixed(2)} req/s, p95=${hotWallet.p95Ms.toFixed(2)}ms, errors=${hotWallet.failedRequests}`);

const report = {
  generatedAt: new Date().toISOString(),
  runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
  configuration: config,
  distributed,
  hotWallet,
};
await mkdir('reports', { recursive: true });
await Bun.write('reports/load-test.json', `${JSON.stringify(report, null, 2)}\n`);
console.log('Load report written to reports/load-test.json');
