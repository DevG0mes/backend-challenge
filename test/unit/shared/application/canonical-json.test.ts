import { describe, expect, test } from 'bun:test';

import {
  canonicalJson,
  hashBusinessPayload,
} from '../../../../src/shared/application/canonical-json';

describe('canonical JSON', () => {
  test('sorts object keys recursively while preserving array order', () => {
    const value = {
      z: 1,
      nested: { beta: 2, alpha: 1 },
      array: [{ y: 2, x: 1 }, 'second'],
      a: true,
    };

    expect(canonicalJson(value)).toBe(
      '{"a":true,"array":[{"x":1,"y":2},"second"],"nested":{"alpha":1,"beta":2},"z":1}',
    );
  });

  test('produces the same SHA-256 hash for semantically identical payloads', () => {
    const first = { providerId: 'provider-a', money: { currency: 'BRL', amount: '25.00' } };
    const second = { money: { amount: '25.00', currency: 'BRL' }, providerId: 'provider-a' };

    expect(hashBusinessPayload(first)).toBe(hashBusinessPayload(second));
    expect(hashBusinessPayload(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  test('excludes transport metadata from the business hash', () => {
    const first = {
      providerId: 'provider-a',
      externalTransactionId: 'transaction-1',
      idempotencyKey: 'transport-key-one',
      messageId: 'message-one',
      correlationId: 'correlation-one',
      occurredAt: '2026-10-15T12:00:00.000Z',
    };
    const second = {
      providerId: 'provider-a',
      externalTransactionId: 'transaction-1',
      idempotencyKey: 'transport-key-two',
      messageId: 'message-two',
      correlationId: 'correlation-two',
      occurredAt: '2026-10-15T13:00:00.000Z',
    };

    expect(hashBusinessPayload(first)).toBe(hashBusinessPayload(second));
  });

  test('changes the hash when a business value changes', () => {
    expect(hashBusinessPayload({ amount: '25.00' })).not.toBe(
      hashBusinessPayload({ amount: '26.00' }),
    );
  });
});
