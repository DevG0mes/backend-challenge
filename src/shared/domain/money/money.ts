import Decimal from 'decimal.js';

import { DomainError } from '../errors/domain.error';

const ExactDecimal = Decimal.clone({ precision: 80 });
const DECIMAL_SHAPE = /^\d+(?:\.\d*)?$/;
const FIXED_SCALE_SHAPE = /^\d+\.\d{2}$/;
const ISO_CURRENCY_SHAPE = /^[A-Za-z]{3}$/;

export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {
    Object.freeze(this);
  }

  static from(props: MoneyProps): Money {
    const currency = Money.normalizeCurrency(props.currency);

    if (!DECIMAL_SHAPE.test(props.amount)) {
      throw new DomainError(
        'INVALID_MONEY_AMOUNT',
        'Money amount must be an unsigned decimal string',
      );
    }

    if (!FIXED_SCALE_SHAPE.test(props.amount)) {
      throw new DomainError(
        'INVALID_MONEY_SCALE',
        'Money amount must have exactly two decimal places',
      );
    }

    return new Money(new ExactDecimal(props.amount), currency);
  }

  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative() && !this.value.isZero();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.value.toFixed(2),
      currency: this.currency,
    };
  }

  toString(): string {
    return `${this.value.toFixed(2)} ${this.currency}`;
  }

  private static normalizeCurrency(currency: string): string {
    if (!ISO_CURRENCY_SHAPE.test(currency)) {
      throw new DomainError(
        'INVALID_CURRENCY',
        'Currency must be a three-letter ISO-4217 code',
      );
    }

    return currency.toUpperCase();
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new DomainError(
        'CURRENCY_MISMATCH',
        `Cannot operate on ${this.currency} and ${other.currency}`,
      );
    }
  }
}
