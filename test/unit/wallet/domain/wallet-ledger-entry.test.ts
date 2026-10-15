import { describe, expect, test } from 'bun:test';

import { DomainError } from '../../../../src/shared/domain/errors/domain.error';
import { Money } from '../../../../src/shared/domain/money/money';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../../../../src/wallet/domain/wallet-ledger-entry';

const CREATED_AT = new Date('2026-10-15T12:00:00.000Z');

function brl(amount: string): Money {
  return Money.from({ amount, currency: 'BRL' });
}

function baseProps() {
  return {
    id: 'entry-1',
    walletId: 'wallet-1',
    transactionId: 'transaction-1',
    money: brl('25.00'),
    createdAt: CREATED_AT,
  };
}

describe('WalletLedgerEntry', () => {
  test('creates an exact balanced debit tied to one wallet and transaction', () => {
    const entry = WalletLedgerEntry.create({
      ...baseProps(),
      direction: LedgerDirection.Debit,
      balanceBefore: brl('100.00'),
      balanceAfter: brl('75.00'),
    });

    expect(entry.walletId).toBe('wallet-1');
    expect(entry.transactionId).toBe('transaction-1');
    expect(entry.isBalanced()).toBeTrue();
  });

  test('creates an exact balanced credit', () => {
    const entry = WalletLedgerEntry.create({
      ...baseProps(),
      direction: LedgerDirection.Credit,
      balanceBefore: brl('100.00'),
      balanceAfter: brl('125.00'),
    });

    expect(entry.isBalanced()).toBeTrue();
  });

  test.each([
    [LedgerDirection.Debit, '100.00', '80.00'],
    [LedgerDirection.Credit, '100.00', '120.00'],
  ])('rejects inconsistent %s arithmetic', (direction, before, after) => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps(),
        direction,
        balanceBefore: brl(before),
        balanceAfter: brl(after),
      }),
    ).toThrow(DomainError);

    try {
      WalletLedgerEntry.create({
        ...baseProps(),
        direction,
        balanceBefore: brl(before),
        balanceAfter: brl(after),
      });
    } catch (error: unknown) {
      expect((error as DomainError).code).toBe('UNBALANCED_LEDGER_ENTRY');
    }
  });

  test('rejects currencies that disagree inside one entry', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps(),
        direction: LedgerDirection.Debit,
        balanceBefore: brl('100.00'),
        balanceAfter: Money.from({ amount: '75.00', currency: 'USD' }),
      }),
    ).toThrow(DomainError);
  });

  test('is structurally immutable after creation', () => {
    const entry = WalletLedgerEntry.create({
      ...baseProps(),
      direction: LedgerDirection.Debit,
      balanceBefore: brl('100.00'),
      balanceAfter: brl('75.00'),
    });

    expect(Object.isFrozen(entry)).toBeTrue();
    expect(() => {
      Object.assign(entry, { walletId: 'wallet-2' });
    }).toThrow();
    expect(entry.walletId).toBe('wallet-1');
  });

  test('rehydrates an existing immutable entry without recreating it', () => {
    const entry = WalletLedgerEntry.rehydrate({
      ...baseProps(),
      direction: LedgerDirection.Credit,
      balanceBefore: brl('75.00'),
      balanceAfter: brl('100.00'),
    });

    expect(entry.createdAt).toEqual(CREATED_AT);
    expect(Object.isFrozen(entry)).toBeTrue();
  });
});
