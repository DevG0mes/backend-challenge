import { describe, expect, test } from 'bun:test';

import { ReadinessService } from '../../../src/health/readiness.service';

describe('ReadinessService', () => {
  test('is ready only when PostgreSQL and SQS are reachable', async () => {
    const ready = new ReadinessService({ check: async () => undefined }, { check: async () => undefined });
    expect(await ready.check()).toEqual({ status: 'ok', dependencies: { postgres: 'up', sqs: 'up' } });
  });

  test('reports each degraded dependency without hiding the healthy one', async () => {
    const postgresDown = new ReadinessService({ check: async () => { throw new Error('down'); } }, { check: async () => undefined });
    expect(await postgresDown.check()).toEqual({ status: 'degraded', dependencies: { postgres: 'down', sqs: 'up' } });
    const sqsDown = new ReadinessService({ check: async () => undefined }, { check: async () => { throw new Error('down'); } });
    expect(await sqsDown.check()).toEqual({ status: 'degraded', dependencies: { postgres: 'up', sqs: 'down' } });
  });
});
