import { describe, expect, test } from 'bun:test';

import { OutboxMessage } from '../../../../src/messaging/domain/outbox-message';

const AT = new Date('2026-10-15T12:00:00.000Z');

describe('OutboxMessage', () => {
  test('starts pending and due immediately', () => {
    const message = create();
    expect(message.isPending()).toBeTrue();
    expect(message.isDue(AT)).toBeTrue();
    expect(message.attempts).toBe(0);
  });

  test('schedules capped exponential retry and increments attempts', () => {
    const message = create();
    message.scheduleRetry(AT, 1_000, 3_600_000);
    expect(message.attempts).toBe(1);
    expect(message.nextAttemptAt?.toISOString()).toBe('2026-10-15T12:00:01.000Z');
    expect(message.isDue(AT)).toBeFalse();

    for (let index = 0; index < 20; index += 1) message.scheduleRetry(AT, 1_000, 3_600_000);
    expect(message.nextAttemptAt?.toISOString()).toBe('2026-10-15T13:00:00.000Z');
  });

  test('becomes terminal after publication', () => {
    const message = create();
    message.markPublished(AT);
    expect(message.isPending()).toBeFalse();
    expect(message.isDue(new Date('2027-01-01T00:00:00.000Z'))).toBeFalse();
    expect(() => message.scheduleRetry(AT, 1_000, 3_600_000)).toThrow('OUTBOX_ALREADY_PUBLISHED');
  });
});

function create(): OutboxMessage {
  return OutboxMessage.enqueue({
    id: 'event-1', aggregateId: 'wallet-1', eventType: 'WagerProcessed', payload: { ok: true }, occurredAt: AT,
  });
}
