import { describe, expect, test } from 'bun:test';

import { Money } from '../../../src/shared/domain/money/money';
import { Wallet } from '../../../src/wallet/domain/wallet';
import { WalletMapper } from '../../../src/wallet/infrastructure/persistence/wallet.mapper';
import { WagerTransactionMapper } from '../../../src/wagering/infrastructure/persistence/wager-transaction.mapper';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/wagering/domain/wager-transaction';

const AT = new Date('2026-10-15T12:00:00.000Z');

describe('persistence mappers', () => {
  test('round-trips a wallet without converting its decimal string', () => {
    const wallet = Wallet.rehydrate({
      id: '0192f291-27dd-7d3f-8071-5f8685deef37',
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      currency: 'BRL',
      balance: Money.from({
        amount: '99999999999999999999999999999999999999.99',
        currency: 'BRL',
      }),
      version: 9,
      createdAt: AT,
      updatedAt: AT,
    });

    const record = WalletMapper.toRecord(wallet);
    const restored = WalletMapper.toDomain(record);

    expect(record.balance).toBe('99999999999999999999999999999999999999.99');
    expect(typeof record.balance).toBe('string');
    expect(restored.balance.toJSON()).toEqual({
      amount: '99999999999999999999999999999999999999.99',
      currency: 'BRL',
    });
    expect(restored.version).toBe(9);
  });

  test('round-trips terminal wager state and exact money', () => {
    const transaction = WagerTransaction.create({
      id: '0192f298-345e-7e38-af88-e43f851a819d',
      providerId: 'provider-a',
      externalTransactionId: 'external-1',
      idempotencyKey: 'provider-a:external-1',
      payloadHash: 'a'.repeat(64),
      walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      referenceExternalTransactionId: undefined,
      createdAt: AT,
    });
    transaction.markProcessed(undefined, AT);

    const record = WagerTransactionMapper.toRecord(transaction);
    const restored = WagerTransactionMapper.toDomain(record);

    expect(record.amount).toBe('25.00');
    expect(restored.status).toBe(WagerTransactionStatus.Processed);
    expect(restored.processedAt).toEqual(AT);
    expect(restored.money.toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
  });
});
