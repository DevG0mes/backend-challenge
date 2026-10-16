export interface MeasurementSummary {
  requests: number;
  requestsPerSecond: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  successfulRequests: number;
  failedRequests: number;
  statusCounts: Record<number, number>;
}

export function summarizeMeasurements(
  samples: readonly number[], durationMs: number, statusCounts: Record<number, number>,
): MeasurementSummary {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (ratio: number) => sorted.length === 0 ? 0 : sorted[Math.max(0, Math.ceil(ratio * sorted.length) - 1)]!;
  const successfulRequests = Object.entries(statusCounts)
    .filter(([status]) => Number(status) >= 200 && Number(status) < 300)
    .reduce((total, [, count]) => total + count, 0);
  return {
    requests: sorted.length,
    requestsPerSecond: durationMs <= 0 ? 0 : sorted.length / (durationMs / 1_000),
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
    maxMs: sorted.at(-1) ?? 0,
    successfulRequests,
    failedRequests: sorted.length - successfulRequests,
    statusCounts,
  };
}
