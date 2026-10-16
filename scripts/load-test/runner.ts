import { summarizeMeasurements, type MeasurementSummary } from './statistics';

export interface ScenarioOptions {
  name: string;
  baseUrls: string[];
  concurrency: number;
  durationMs: number;
  walletCount: number;
  warmupRequests: number;
  amount: string;
  initialBalance: string;
}

export interface ScenarioResult extends MeasurementSummary {
  name: string;
  durationMs: number;
  concurrency: number;
  walletCount: number;
  reconciliation: { checked: number; inconsistent: number };
}

interface WalletTarget { id: string; playerId: string }

export async function runScenario(options: ScenarioOptions): Promise<ScenarioResult> {
  let targetIndex = 0;
  let requestIndex = 0;
  const runId = `${options.name}-${Date.now()}-${crypto.randomUUID()}`;
  const nextUrl = () => options.baseUrls[targetIndex++ % options.baseUrls.length]!;
  const wallets: WalletTarget[] = [];

  for (let index = 0; index < options.walletCount; index += 1) {
    const playerId = crypto.randomUUID();
    const response = await fetch(`${nextUrl()}/wallets`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: options.initialBalance, currency: 'BRL' } }),
    });
    if (response.status !== 201) throw new Error(`wallet setup failed with HTTP ${response.status}`);
    const body = await response.json() as { id?: string };
    if (!body.id) throw new Error('wallet setup returned no id');
    wallets.push({ id: body.id, playerId });
  }

  const sendWager = async (): Promise<number> => {
    const sequence = requestIndex++;
    const wallet = wallets[sequence % wallets.length]!;
    const identity = `${runId}-${sequence}`;
    try {
      const response = await fetch(`${nextUrl()}/wagering/transactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': `load:${identity}` },
        body: JSON.stringify({
          providerId: 'load-test', externalTransactionId: identity, playerId: wallet.playerId,
          walletId: wallet.id, roundId: `round-${identity}`, gameId: 'load-test', kind: 'BET',
          money: { amount: options.amount, currency: 'BRL' },
        }),
      });
      await response.arrayBuffer();
      return response.status;
    } catch {
      return 0;
    }
  };

  for (let index = 0; index < options.warmupRequests; index += 1) await sendWager();

  const samples: number[] = [];
  const statusCounts: Record<number, number> = {};
  const startedAt = performance.now();
  const deadline = startedAt + options.durationMs;
  const worker = async () => {
    while (performance.now() < deadline) {
      const requestStartedAt = performance.now();
      const status = await sendWager();
      samples.push(Number((performance.now() - requestStartedAt).toFixed(2)));
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    }
  };
  await Promise.all(Array.from({ length: options.concurrency }, worker));
  const actualDurationMs = performance.now() - startedAt;

  let inconsistent = 0;
  for (const wallet of wallets) {
    const response = await fetch(`${nextUrl()}/wallets/${wallet.id}/reconciliation`, { method: 'POST' });
    if (!response.ok) throw new Error(`reconciliation failed with HTTP ${response.status}`);
    const body = await response.json() as { consistent?: boolean };
    if (body.consistent !== true) inconsistent += 1;
  }
  if (inconsistent > 0) throw new Error(`reconciliation mismatch in ${inconsistent} wallet(s)`);

  return {
    name: options.name,
    durationMs: Number(actualDurationMs.toFixed(2)),
    concurrency: options.concurrency,
    walletCount: options.walletCount,
    reconciliation: { checked: wallets.length, inconsistent },
    ...summarizeMeasurements(samples, actualDurationMs, statusCounts),
  };
}
