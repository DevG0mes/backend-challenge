import { describe, expect, test } from 'bun:test';

import { StructuredLogger } from '../../../../src/shared/observability/logger';
import { InMemoryMetrics } from '../../../../src/shared/observability/metrics';

describe('operational visibility', () => {
  test('writes structured context while redacting financial payloads and secrets', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger((line) => lines.push(line));
    logger.info('wager processed', {
      correlationId: 'correlation-1', transactionId: 'transaction-1', walletId: 'wallet-1',
      payload: { money: { amount: '500.00', currency: 'BRL' }, password: 'hidden' },
      authorization: 'Bearer hidden',
    });
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry).toMatchObject({ level: 'info', message: 'wager processed', correlationId: 'correlation-1', transactionId: 'transaction-1', walletId: 'wallet-1' });
    expect(JSON.stringify(entry)).not.toContain('500.00');
    expect(JSON.stringify(entry)).not.toContain('Bearer hidden');
    expect(JSON.stringify(entry)).not.toContain('hidden');
  });

  test('tracks required counters, histograms, and gauges by labels', () => {
    const metrics = new InMemoryMetrics();
    metrics.increment('wager_transactions_total', { status: 'PROCESSED' });
    metrics.increment('wager_transactions_total', { status: 'PROCESSED' });
    metrics.observe('wager_processing_latency_ms', 12.5, { kind: 'BET' });
    metrics.setGauge('outbox_lag_seconds', 3.2);
    expect(metrics.counter('wager_transactions_total', { status: 'PROCESSED' })).toBe(2);
    expect(metrics.histogram('wager_processing_latency_ms', { kind: 'BET' })).toEqual([12.5]);
    expect(metrics.gauge('outbox_lag_seconds')).toBe(3.2);
  });

  test('renders deterministic Prometheus text with normalized names and escaped labels', () => {
    const metrics = new InMemoryMetrics();
    metrics.setGauge('outbox-lag.seconds', 3.2);
    metrics.observe('wager_processing_latency_ms', 12.5, { kind: 'BET' });
    metrics.observe('wager_processing_latency_ms', 7.5, { kind: 'BET' });
    metrics.increment('wager-transactions.total', {
      note: 'quote" slash\\ newline\n',
      status: 'PROCESSED',
    }, 2);

    expect(metrics.toPrometheus()).toBe([
      '# TYPE outbox_lag_seconds gauge',
      'outbox_lag_seconds 3.2',
      '# TYPE wager_processing_latency_ms histogram',
      'wager_processing_latency_ms_count{kind="BET"} 2',
      'wager_processing_latency_ms_sum{kind="BET"} 20',
      '# TYPE wager_transactions_total counter',
      'wager_transactions_total{note="quote\\" slash\\\\ newline\\n",status="PROCESSED"} 2',
      '',
    ].join('\n'));
  });

  test('keeps histogram memory bounded while preserving cumulative count and sum', () => {
    const metrics = new InMemoryMetrics();
    for (let value = 1; value <= 101; value += 1) metrics.observe('latency_ms', value);

    expect(metrics.histogram('latency_ms')).toHaveLength(100);
    expect(metrics.toPrometheus()).toContain('latency_ms_count 101');
    expect(metrics.toPrometheus()).toContain('latency_ms_sum 5151');
  });
});
