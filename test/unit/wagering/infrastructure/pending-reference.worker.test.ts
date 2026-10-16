import { describe, expect, test } from 'bun:test';

import { PendingReferenceWorker } from '../../../../src/wagering/infrastructure/workers/pending-reference.worker';

describe('PendingReferenceWorker', () => {
  test('polls immediately and stops cleanly after an in-flight batch', async () => {
    let calls = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const processor = {
      execute: async () => {
        calls += 1;
        await blocked;
        return { claimed: 0, processed: 0, rejected: 0, rescheduled: 0 };
      },
    };
    const worker = new PendingReferenceWorker(
      processor,
      { now: () => new Date('2026-10-16T12:00:00.000Z') },
      10_000,
      25,
    );

    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toBe(1);
    const draining = worker.drain(100);
    release();
    expect(await draining).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toBe(1);
  });
});
