import { describe, expect, test } from 'bun:test';

import { DomainError, type DomainErrorCode } from '../../../../src/shared/domain/errors/domain.error';
import { Money } from '../../../../src/shared/domain/money/money';

function expectDomainError(action: () => unknown, code: DomainErrorCode): void {
  try {
    action();
    throw new Error(`Expected DomainError with code ${code}`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}

describe('Money parsing and serialization', () => {
  test('preserves an exact two-decimal amount', () => {
    const money = Money.from({ amount: '25.00', currency: 'brl' });

    expect(money.toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
    expect(money.toString()).toBe('25.00 BRL');
  });

  test('creates exact zero in the requested currency', () => {
    expect(Money.zero('brl').toJSON()).toEqual({
      amount: '0.00',
      currency: 'BRL',
    });
  });

  test.each(['', ' ', 'NaN', 'Infinity', '-Infinity', '1e2', '+1.00', '-1.00'])(
    'rejects invalid decimal amount %p',
    (amount) => {
      expectDomainError(
        () => Money.from({ amount, currency: 'BRL' }),
        'INVALID_MONEY_AMOUNT',
      );
    },
  );

  test.each(['1', '1.0', '1.000', '0.001', '25.'])('rejects invalid scale %p', (amount) => {
    expectDomainError(
      () => Money.from({ amount, currency: 'BRL' }),
      'INVALID_MONEY_SCALE',
    );
  });

  test.each(['', 'br', 'BRLL', '12A', 'BR$'])('rejects invalid ISO currency %p', (currency) => {
    expectDomainError(
      () => Money.from({ amount: '1.00', currency }),
      'INVALID_CURRENCY',
    );
  });
});

describe('Money arithmetic and comparison', () => {
  test('adds exact decimal values without floating-point drift', () => {
    const result = Money.from({ amount: '0.10', currency: 'BRL' }).add(
      Money.from({ amount: '0.20', currency: 'BRL' }),
    );

    expect(result.toJSON()).toEqual({ amount: '0.30', currency: 'BRL' });
  });

  test('subtracts and represents a negative domain result exactly', () => {
    const result = Money.from({ amount: '10.00', currency: 'BRL' }).subtract(
      Money.from({ amount: '25.00', currency: 'BRL' }),
    );

    expect(result.toJSON()).toEqual({ amount: '-15.00', currency: 'BRL' });
    expect(result.isNegative()).toBeTrue();
  });

  test('negates without changing the original value', () => {
    const original = Money.from({ amount: '12.34', currency: 'BRL' });

    expect(original.negate().toJSON()).toEqual({ amount: '-12.34', currency: 'BRL' });
    expect(original.toJSON()).toEqual({ amount: '12.34', currency: 'BRL' });
  });

  test('keeps large values exact', () => {
    const result = Money.from({
      amount: '99999999999999999999999999999999999999.99',
      currency: 'BRL',
    }).add(Money.from({ amount: '0.01', currency: 'BRL' }));

    expect(result.toJSON()).toEqual({
      amount: '100000000000000000000000000000000000000.00',
      currency: 'BRL',
    });
  });

  test('reports zero, positive, negative, ordering, and equality', () => {
    const zero = Money.zero('BRL');
    const one = Money.from({ amount: '1.00', currency: 'BRL' });
    const two = Money.from({ amount: '2.00', currency: 'BRL' });

    expect(zero.isZero()).toBeTrue();
    expect(one.isPositive()).toBeTrue();
    expect(one.negate().isNegative()).toBeTrue();
    expect(one.isLessThan(two)).toBeTrue();
    expect(one.equals(Money.from({ amount: '1.00', currency: 'BRL' }))).toBeTrue();
    expect(one.equals(two)).toBeFalse();
  });

  test.each([
    ['add', (left: Money, right: Money) => left.add(right)],
    ['subtract', (left: Money, right: Money) => left.subtract(right)],
    ['isLessThan', (left: Money, right: Money) => left.isLessThan(right)],
    ['equals', (left: Money, right: Money) => left.equals(right)],
  ] as const)('rejects cross-currency %s', (_name, operation) => {
    const brl = Money.from({ amount: '1.00', currency: 'BRL' });
    const usd = Money.from({ amount: '1.00', currency: 'USD' });

    expectDomainError(() => operation(brl, usd), 'CURRENCY_MISMATCH');
  });
});
