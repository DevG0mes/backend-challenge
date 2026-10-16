import { DomainError } from '../../shared/domain/errors/domain.error';
import { Money } from '../../shared/domain/money/money';

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  createdAt: Date;
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletBalanceChange {
  balanceBefore: Money;
  balanceAfter: Money;
  version: number;
}

export class Wallet {
  private readonly _createdAt: Date;
  private _updatedAt: Date;

  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    createdAt: Date,
    updatedAt: Date,
  ) {
    this._createdAt = new Date(createdAt);
    this._updatedAt = new Date(updatedAt);
  }

  static open(props: OpenWalletProps): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new DomainError(
        'NEGATIVE_INITIAL_BALANCE',
        'A wallet cannot be opened with a negative balance',
      );
    }

    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      props.createdAt,
      props.createdAt,
    );
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get createdAt(): Date {
    return new Date(this._createdAt);
  }

  get updatedAt(): Date {
    return new Date(this._updatedAt);
  }

  debit(money: Money, at: Date): WalletBalanceChange {
    this.assertSameCurrency(money);
    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.subtract(money);

    if (balanceAfter.isNegative()) {
      throw new DomainError('INSUFFICIENT_FUNDS', 'Wallet has insufficient funds');
    }

    return this.applyChange(balanceBefore, balanceAfter, at);
  }

  credit(money: Money, at: Date): WalletBalanceChange {
    this.assertSameCurrency(money);
    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.add(money);

    return this.applyChange(balanceBefore, balanceAfter, at);
  }

  private applyChange(
    balanceBefore: Money,
    balanceAfter: Money,
    at: Date,
  ): WalletBalanceChange {
    if (!balanceBefore.equals(balanceAfter)) {
      this._balance = balanceAfter;
      this._version += 1;
      this._updatedAt = new Date(at);
    }

    return { balanceBefore, balanceAfter, version: this._version };
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new DomainError(
        'CURRENCY_MISMATCH',
        `Wallet currency ${this.currency} does not match ${money.currency}`,
      );
    }
  }
}
