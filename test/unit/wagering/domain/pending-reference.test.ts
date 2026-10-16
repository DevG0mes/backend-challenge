import { describe, expect, test } from 'bun:test';

import { Money } from '../../../../src/shared/domain/money/money';
import { FailureCode } from '../../../../src/wagering/domain/failure-code';
import { WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from '../../../../src/wagering/domain/wager-transaction';

const NOW = new Date('2026-10-16T12:00:00.000Z');

describe('pending reference retry policy', () => {
  test('schedules exponential attempts with a one-hour cap', () => {
    const transaction = pending();
    transaction.scheduleReferenceRetry(NOW, { maxAttempts: 30, baseDelayMs: 1_000, maxDelayMs: 3_600_000 });
    expect(transaction.pendingAttempts).toBe(1);
    expect(transaction.nextAttemptAt?.toISOString()).toBe('2026-10-16T12:00:01.000Z');

    for (let index = 0; index < 20; index += 1) {
      transaction.scheduleReferenceRetry(NOW, { maxAttempts: 30, baseDelayMs: 1_000, maxDelayMs: 3_600_000 });
    }
    expect(transaction.nextAttemptAt?.toISOString()).toBe('2026-10-16T13:00:00.000Z');
  });

  test('rejects with REFERENCE_NOT_FOUND on the configurable final attempt', () => {
    const transaction = pending();
    for (let index = 0; index < 10; index += 1) {
      transaction.scheduleReferenceRetry(NOW, { maxAttempts: 10, baseDelayMs: 1_000, maxDelayMs: 3_600_000 });
    }
    expect(transaction.pendingAttempts).toBe(10);
    expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(transaction.failureCode).toBe(FailureCode.ReferenceNotFound);
    expect(transaction.nextAttemptAt).toBeUndefined();
  });

  test('does not allow retry metadata to mutate terminal transactions', () => {
    const transaction = pending();
    transaction.reject(FailureCode.ReferenceMismatch, Money.from({ amount: '100.00', currency: 'BRL' }));
    expect(() => transaction.scheduleReferenceRetry(NOW, { maxAttempts: 10, baseDelayMs: 1_000, maxDelayMs: 3_600_000 })).toThrow('terminal state');
  });
});

function pending(): WagerTransaction {
  const transaction = WagerTransaction.create({
    id: '0192f298-345e-7e38-af88-e43f851a819d', providerId: 'provider-a', externalTransactionId: 'refund-1',
    idempotencyKey: 'provider-a:refund-1', payloadHash: 'a'.repeat(64), walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
    playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1', roundId: 'round-1', gameId: 'game-1',
    kind: WagerTransactionKind.Refund, money: Money.from({ amount: '25.00', currency: 'BRL' }), referenceExternalTransactionId: 'bet-1', createdAt: NOW,
  });
  transaction.markPendingReference(Money.from({ amount: '100.00', currency: 'BRL' }));
  return transaction;
}
