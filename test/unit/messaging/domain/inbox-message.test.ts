import { describe, expect, test } from 'bun:test';

import { InboxMessage } from '../../../../src/messaging/domain/inbox-message';

const RECEIVED = new Date('2026-10-15T12:00:00.000Z');
const PROCESSED = new Date('2026-10-15T12:00:01.000Z');

describe('InboxMessage', () => {
  test('is received once and completes once', () => {
    const message = InboxMessage.receive({
      consumerName: 'wager-consumer', messageId: 'message-1', payloadHash: 'a'.repeat(64), receivedAt: RECEIVED,
    });
    expect(message.isProcessed()).toBeFalse();
    message.complete(PROCESSED);
    expect(message.isProcessed()).toBeTrue();
    expect(message.processedAt).toEqual(PROCESSED);
    expect(() => message.complete(PROCESSED)).toThrow('INBOX_ALREADY_COMPLETED');
  });

  test('rehydrates timestamps and detects payload identity', () => {
    const message = InboxMessage.rehydrate({
      consumerName: 'wager-consumer', messageId: 'message-1', payloadHash: 'a'.repeat(64),
      receivedAt: RECEIVED, processedAt: PROCESSED,
    });
    expect(message.receivedAt).toEqual(RECEIVED);
    expect(message.processedAt).toEqual(PROCESSED);
    expect(message.matchesPayload('a'.repeat(64))).toBeTrue();
    expect(message.matchesPayload('b'.repeat(64))).toBeFalse();
  });
});
