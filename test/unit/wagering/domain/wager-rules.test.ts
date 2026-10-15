import { describe, expect, test } from 'bun:test';

import { Money } from '../../../../src/shared/domain/money/money';
import { LedgerDirection } from '../../../../src/wallet/domain/wallet-ledger-entry';
import { Wallet } from '../../../../src/wallet/domain/wallet';
import { FailureCode } from '../../../../src/wagering/domain/failure-code';
import {
  WagerTransaction,
  WagerTransactionKind,
  type CreateWagerTransactionProps,
} from '../../../../src/wagering/domain/wager-transaction';
import { evaluateWager } from '../../../../src/wagering/domain/wager-rules';

const NOW = new Date('2026-10-15T12:00:00.000Z');

function money(amount: string, currency = 'BRL'): Money {
  return Money.from({ amount, currency });
}

function wallet(balance = '100.00'): Wallet {
  return Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: money(balance),
    createdAt: NOW,
  });
}

function transaction(
  kind: WagerTransactionKind,
  overrides: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction {
  return WagerTransaction.create({
    id: `internal-${kind}`,
    providerId: 'provider-a',
    externalTransactionId: `external-${kind}`,
    idempotencyKey: `provider-a:external-${kind}`,
    payloadHash: `hash-${kind}`,
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind,
    money: money('25.00'),
    referenceExternalTransactionId:
      kind === WagerTransactionKind.Refund || kind === WagerTransactionKind.Rollback
        ? 'external-BET'
        : undefined,
    createdAt: NOW,
    ...overrides,
  });
}

function processed(
  kind: WagerTransactionKind,
  overrides: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction {
  const result = transaction(kind, overrides);
  result.markProcessed(
    kind === WagerTransactionKind.Refund || kind === WagerTransactionKind.Rollback
      ? 'internal-BET'
      : undefined,
    NOW,
  );
  return result;
}

describe('evaluateWager', () => {
  test('rejects an operation whose currency differs from the wallet', () => {
    const bet = transaction(WagerTransactionKind.Bet, { money: money('25.00', 'USD') });

    expect(evaluateWager(bet, wallet())).toEqual({
      type: 'REJECT',
      failureCode: FailureCode.CurrencyMismatch,
    });
  });

  test('rejects an operation addressed to another wallet or player', () => {
    const wrongWallet = transaction(WagerTransactionKind.Bet, { walletId: 'wallet-2' });
    const wrongPlayer = transaction(WagerTransactionKind.Bet, { playerId: 'player-2' });

    expect(evaluateWager(wrongWallet, wallet())).toEqual({
      type: 'REJECT',
      failureCode: FailureCode.WalletMismatch,
    });
    expect(evaluateWager(wrongPlayer, wallet())).toEqual({
      type: 'REJECT',
      failureCode: FailureCode.WalletMismatch,
    });
  });

  test('applies BET as a debit when funds are available', () => {
    expect(evaluateWager(transaction(WagerTransactionKind.Bet), wallet())).toEqual({
      type: 'APPLY',
      direction: LedgerDirection.Debit,
      referenceTransactionId: undefined,
    });
  });

  test('rejects BET when funds are insufficient', () => {
    expect(evaluateWager(transaction(WagerTransactionKind.Bet), wallet('24.99'))).toEqual({
      type: 'REJECT',
      failureCode: FailureCode.InsufficientFunds,
    });
  });

  test('applies WIN as credit and LOSS without balance direction', () => {
    expect(evaluateWager(transaction(WagerTransactionKind.Win), wallet())).toEqual({
      type: 'APPLY',
      direction: LedgerDirection.Credit,
      referenceTransactionId: undefined,
    });
    expect(evaluateWager(transaction(WagerTransactionKind.Loss), wallet())).toEqual({
      type: 'APPLY',
      direction: undefined,
      referenceTransactionId: undefined,
    });
  });

  test.each([WagerTransactionKind.Refund, WagerTransactionKind.Rollback])(
    'keeps %s pending when its reference has not arrived',
    (kind) => {
      expect(evaluateWager(transaction(kind), wallet())).toEqual({ type: 'PENDING_REFERENCE' });
    },
  );

  test('applies REFUND as credit for its matching processed BET', () => {
    const reference = processed(WagerTransactionKind.Bet);

    expect(evaluateWager(transaction(WagerTransactionKind.Refund), wallet(), reference)).toEqual({
      type: 'APPLY',
      direction: LedgerDirection.Credit,
      referenceTransactionId: reference.id,
    });
  });

  test.each([
    ['providerId', { providerId: 'provider-b' }],
    ['playerId', { playerId: 'player-2' }],
    ['walletId', { walletId: 'wallet-2' }],
    ['roundId', { roundId: 'round-2' }],
  ] as const)('rejects a reference with mismatched %s', (_field, override) => {
    const reference = processed(WagerTransactionKind.Bet, override);

    expect(evaluateWager(transaction(WagerTransactionKind.Refund), wallet(), reference)).toEqual({
      type: 'REJECT',
      failureCode: FailureCode.ReferenceMismatch,
    });
  });

  test('rejects a reference with mismatched currency', () => {
    const reference = processed(WagerTransactionKind.Bet, { money: money('25.00', 'USD') });

    expect(evaluateWager(transaction(WagerTransactionKind.Refund), wallet(), reference)).toEqual({
      type: 'REJECT',
      failureCode: FailureCode.CurrencyMismatch,
    });
  });

  test('rejects a reference with a different amount', () => {
    const reference = processed(WagerTransactionKind.Bet, { money: money('24.00') });

    expect(evaluateWager(transaction(WagerTransactionKind.Refund), wallet(), reference)).toEqual({
      type: 'REJECT',
      failureCode: FailureCode.AmountMismatch,
    });
  });

  test('rejects a provider reference whose external ID does not match', () => {
    const reference = processed(WagerTransactionKind.Bet, {
      externalTransactionId: 'another-external-id',
    });

    expect(evaluateWager(transaction(WagerTransactionKind.Refund), wallet(), reference)).toEqual({
      type: 'REJECT',
      failureCode: FailureCode.ReferenceMismatch,
    });
  });

  test('rejects a reference that is not processed', () => {
    const reference = transaction(WagerTransactionKind.Bet);

    expect(evaluateWager(transaction(WagerTransactionKind.Refund), wallet(), reference)).toEqual({
      type: 'REJECT',
      failureCode: FailureCode.ReferenceNotProcessed,
    });
  });

  test('rejects REFUND of anything other than BET', () => {
    const reference = processed(WagerTransactionKind.Win, {
      externalTransactionId: 'external-BET',
    });

    expect(evaluateWager(transaction(WagerTransactionKind.Refund), wallet(), reference)).toEqual({
      type: 'REJECT',
      failureCode: FailureCode.InvalidReferenceKind,
    });
  });

  test.each([
    [WagerTransactionKind.Bet, LedgerDirection.Credit],
    [WagerTransactionKind.Win, LedgerDirection.Debit],
    [WagerTransactionKind.Refund, LedgerDirection.Debit],
  ])('ROLLBACK reverses processed %s with %s', (referenceKind, direction) => {
    const reference = processed(referenceKind, {
      externalTransactionId: 'external-BET',
    });

    expect(evaluateWager(transaction(WagerTransactionKind.Rollback), wallet(), reference)).toEqual({
      type: 'APPLY',
      direction,
      referenceTransactionId: reference.id,
    });
  });

  test('rejects a reversal debit that would make the wallet negative', () => {
    const reference = processed(WagerTransactionKind.Win, {
      externalTransactionId: 'external-BET',
    });

    expect(
      evaluateWager(transaction(WagerTransactionKind.Rollback), wallet('24.99'), reference),
    ).toEqual({
      type: 'REJECT',
      failureCode: FailureCode.ReversalNegativeBalance,
    });
  });

  test.each([WagerTransactionKind.Refund, WagerTransactionKind.Rollback])(
    'rejects a second %s of the same reference',
    (kind) => {
      const reference = processed(WagerTransactionKind.Bet);
      const priorReversal = transaction(kind, {
        id: `prior-${kind}`,
        externalTransactionId: `prior-external-${kind}`,
      });
      priorReversal.markProcessed(reference.id, NOW);

      expect(evaluateWager(transaction(kind), wallet(), reference, [priorReversal])).toEqual({
        type: 'REJECT',
        failureCode: FailureCode.AlreadyReversed,
      });
    },
  );
});
