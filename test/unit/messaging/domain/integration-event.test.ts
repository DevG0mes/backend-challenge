import { describe, expect, test } from 'bun:test';

import { WagerProcessedEvent } from '../../../../src/messaging/domain/events/wager-processed.event';

describe('IntegrationEvent', () => {
  test('owns stable envelope metadata and JSON-safe financial data', () => {
    const occurredAt = new Date('2026-10-15T12:00:00.000Z');
    const event = new WagerProcessedEvent({
      id: 'event-1', occurredAt, correlationId: 'correlation-1', causationId: 'request-1',
      transactionId: 'transaction-1', walletId: 'wallet-1', providerId: 'provider-a',
      status: 'PROCESSED', balance: { amount: '75.00', currency: 'BRL' },
    });

    expect(event.toJSON()).toEqual({
      id: 'event-1', type: 'WagerProcessed', version: 1,
      occurredAt: '2026-10-15T12:00:00.000Z', correlationId: 'correlation-1', causationId: 'request-1',
      data: { transactionId: 'transaction-1', walletId: 'wallet-1', providerId: 'provider-a', status: 'PROCESSED', balance: { amount: '75.00', currency: 'BRL' } },
    });
    expect(event.toJSON()).toEqual(event.toJSON());
  });
});
