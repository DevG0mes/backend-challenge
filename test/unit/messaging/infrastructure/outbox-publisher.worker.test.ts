import { expect, test } from 'bun:test';

import { OutboxPublisherWorker } from '../../../../src/messaging/infrastructure/sqs/outbox-publisher.worker';

test('outbox worker does not schedule new work after graceful stop', async () => {
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const batch = { execute: async () => { calls += 1; await blocked; return { claimed: 0, published: 0, failed: 0, oldestLagMs: 0 }; } };
  const worker = new OutboxPublisherWorker(batch, { now: () => new Date() }, 5, 10);

  worker.start();
  await new Promise((resolve) => setTimeout(resolve, 5));
  worker.stopPolling();
  release();
  expect(await worker.drain(100)).toBeTrue();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(calls).toBe(1);
});
