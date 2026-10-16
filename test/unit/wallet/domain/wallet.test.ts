import { describe, expect, test } from 'bun:test';

import { DomainError } from '../../../../src/shared/domain/errors/domain.error';
import { Money } from '../../../../src/shared/domain/money/money';
import { Wallet } from '../../../../src/wallet/domain/wallet';

const OPENED_AT = new Date('2026-10-15T12:00:00.000Z');
const CHANGED_AT = new Date('2026-10-15T12:01:00.000Z');

function brl(amount: string): Money {
  return Money.from({ amount, currency: 'BRL' });
}

function expectDomainError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`Expected DomainError with code ${code}`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}

describe('Wallet', () => {
  test('opens at version one with the exact initial balance', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: brl('100.00'),
      createdAt: OPENED_AT,
    });

    expect(wallet.balance.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(wallet.currency).toBe('BRL');
    expect(wallet.version).toBe(1);
    expect(wallet.createdAt).toEqual(OPENED_AT);
    expect(wallet.updatedAt).toEqual(OPENED_AT);
  });

  test('debits exact money and increments version once', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: brl('100.00'),
      createdAt: OPENED_AT,
    });

    const change = wallet.debit(brl('25.00'), CHANGED_AT);

    expect(change.balanceBefore.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(change.balanceAfter.toJSON()).toEqual({ amount: '75.00', currency: 'BRL' });
    expect(wallet.balance.toJSON()).toEqual({ amount: '75.00', currency: 'BRL' });
    expect(wallet.version).toBe(2);
    expect(wallet.updatedAt).toEqual(CHANGED_AT);
  });

  test('credits exact money and increments version once', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: brl('10.00'),
      createdAt: OPENED_AT,
    });

    const change = wallet.credit(brl('2.50'), CHANGED_AT);

    expect(change.balanceAfter.toJSON()).toEqual({ amount: '12.50', currency: 'BRL' });
    expect(wallet.version).toBe(2);
  });

  test('does not increment version for a zero-value operation', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: brl('10.00'),
      createdAt: OPENED_AT,
    });

    wallet.credit(brl('0.00'), CHANGED_AT);

    expect(wallet.version).toBe(1);
    expect(wallet.updatedAt).toEqual(OPENED_AT);
  });

  test('rejects a debit greater than the available balance without mutation', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: brl('10.00'),
      createdAt: OPENED_AT,
    });

    expectDomainError(() => wallet.debit(brl('10.01'), CHANGED_AT), 'INSUFFICIENT_FUNDS');
    expect(wallet.balance.toJSON()).toEqual({ amount: '10.00', currency: 'BRL' });
    expect(wallet.version).toBe(1);
  });

  test('rejects cross-currency debit and credit without mutation', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: brl('10.00'),
      createdAt: OPENED_AT,
    });
    const usd = Money.from({ amount: '1.00', currency: 'USD' });

    expectDomainError(() => wallet.debit(usd, CHANGED_AT), 'CURRENCY_MISMATCH');
    expectDomainError(() => wallet.credit(usd, CHANGED_AT), 'CURRENCY_MISMATCH');
    expect(wallet.balance.toJSON()).toEqual({ amount: '10.00', currency: 'BRL' });
  });

  test('rejects a negative opening balance', () => {
    const negative = Money.zero('BRL').subtract(brl('0.01'));

    expectDomainError(
      () =>
        Wallet.open({
          id: 'wallet-1',
          playerId: 'player-1',
          initialBalance: negative,
          createdAt: OPENED_AT,
        }),
      'NEGATIVE_INITIAL_BALANCE',
    );
  });

  test('rehydrates persisted state without replaying transitions', () => {
    const updatedAt = new Date('2026-10-15T13:00:00.000Z');
    const wallet = Wallet.rehydrate({
      id: 'wallet-1',
      playerId: 'player-1',
      currency: 'BRL',
      balance: brl('37.50'),
      version: 7,
      createdAt: OPENED_AT,
      updatedAt,
    });

    expect(wallet.balance.toJSON()).toEqual({ amount: '37.50', currency: 'BRL' });
    expect(wallet.version).toBe(7);
    expect(wallet.updatedAt).toEqual(updatedAt);
  });
});
