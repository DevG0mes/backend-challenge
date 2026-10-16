import { describe, expect, test } from 'bun:test';

import { summarizeMeasurements } from '../../../scripts/load-test/statistics';

describe('load test statistics', () => {
  test('returns deterministic zeros for no samples', () => {
    expect(summarizeMeasurements([], 1_000, {})).toEqual({
      requests: 0, requestsPerSecond: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0,
      maxMs: 0, successfulRequests: 0, failedRequests: 0, statusCounts: {},
    });
  });

  test('uses nearest-rank percentiles and status totals', () => {
    expect(summarizeMeasurements([1, 2, 3, 4, 100], 2_000, { 201: 4, 503: 1 })).toEqual({
      requests: 5, requestsPerSecond: 2.5, p50Ms: 3, p95Ms: 100, p99Ms: 100,
      maxMs: 100, successfulRequests: 4, failedRequests: 1,
      statusCounts: { 201: 4, 503: 1 },
    });
  });

  test('handles one sample', () => {
    expect(summarizeMeasurements([7.25], 500, { 201: 1 })).toMatchObject({
      p50Ms: 7.25, p95Ms: 7.25, p99Ms: 7.25, maxMs: 7.25, requestsPerSecond: 2,
    });
  });
});
