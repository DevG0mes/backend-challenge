import { describe, expect, test } from 'bun:test';

import { DomainError, type DomainErrorCode } from '../../../../src/shared/domain/errors/domain.error';
import { Money } from '../../../../src/shared/domain/money/money';
import { LedgerDirection } from '../../../../src/wallet/domain/wallet-ledger-entry';
import { FailureCode } from '../../../../src/wagering/domain/failure-code';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  type CreateWagerTransactionProps,
} from '../../../../src/wagering/domain/wager-transaction';

const CREATED_AT = new Date('2026-10-15T12:00:00.000Z');
const PROCESSED_AT = new Date('2026-10-15T12:01:00.000Z');

function props(
  kind: WagerTransactionKind,
  overrides: Partial<CreateWagerTransactionProps> = {},
): CreateWagerTransactionProps {
  return {
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
    money: Money.from({ amount: '25.00', currency: 'BRL' }),
    referenceExternalTransactionId:
      kind === WagerTransactionKind.Refund || kind === WagerTransactionKind.Rollback
        ? 'external-reference'
        : undefined,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function expectDomainError(action: () => unknown, code: DomainErrorCode): void {
  try {
    action();
    throw new Error(`Expected DomainError with code ${code}`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}

describe('WagerTransaction', () => {
  test.each([WagerTransactionKind.Refund, WagerTransactionKind.Rollback])(
    '%s requires an external provider reference',
    (kind) => {
      expectDomainError(
        () => WagerTransaction.create(props(kind, { referenceExternalTransactionId: undefined })),
        'REFERENCE_REQUIRED',
      );
    },
  );

  test('starts pending and matches only its canonical payload hash', () => {
    const transaction = WagerTransaction.create(props(WagerTransactionKind.Bet));

    expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    expect(transaction.matchesPayload('hash-BET')).toBeTrue();
    expect(transaction.matchesPayload('another-hash')).toBeFalse();
    expect(transaction.isTerminal()).toBeFalse();
  });

  test('moves to pending reference without becoming terminal', () => {
    const transaction = WagerTransaction.create(props(WagerTransactionKind.Refund));

    transaction.markPendingReference();

    expect(transaction.status).toBe(WagerTransactionStatus.PendingReference);
    expect(transaction.isTerminal()).toBeFalse();
  });

  test('marks a referenced transaction processed with audit data', () => {
    const transaction = WagerTransaction.create(props(WagerTransactionKind.Refund));

    transaction.markProcessed('internal-bet', PROCESSED_AT);

    expect(transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(transaction.referenceTransactionId).toBe('internal-bet');
    expect(transaction.processedAt).toEqual(PROCESSED_AT);
    expect(transaction.isTerminal()).toBeTrue();
  });

  test.each([
    ['processed', (transaction: WagerTransaction) => transaction.markProcessed(undefined, PROCESSED_AT)],
    ['rejected', (transaction: WagerTransaction) => transaction.reject(FailureCode.InsufficientFunds)],
    ['failed', (transaction: WagerTransaction) => transaction.fail(FailureCode.InfrastructurePermanent)],
  ] as const)('protects the %s terminal state from later transitions', (_name, terminate) => {
    const transaction = WagerTransaction.create(props(WagerTransactionKind.Bet));
    terminate(transaction);

    expectDomainError(() => transaction.markPendingReference(), 'INVALID_TRANSACTION_STATE');
    expectDomainError(
      () => transaction.markProcessed(undefined, PROCESSED_AT),
      'INVALID_TRANSACTION_STATE',
    );
    expectDomainError(
      () => transaction.reject(FailureCode.InsufficientFunds),
      'INVALID_TRANSACTION_STATE',
    );
    expectDomainError(
      () => transaction.fail(FailureCode.InfrastructurePermanent),
      'INVALID_TRANSACTION_STATE',
    );
  });

  test('records stable rejection and failure codes', () => {
    const rejected = WagerTransaction.create(props(WagerTransactionKind.Bet));
    const failed = WagerTransaction.create(
      props(WagerTransactionKind.Bet, { id: 'failed-transaction' }),
    );

    rejected.reject(FailureCode.InsufficientFunds);
    failed.fail(FailureCode.InfrastructurePermanent);

    expect(rejected.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(failed.failureCode).toBe(FailureCode.InfrastructurePermanent);
  });

  test('LOSS is processed but never affects balance or ledger', () => {
    const loss = WagerTransaction.create(props(WagerTransactionKind.Loss));

    expect(loss.affectsBalance()).toBeFalse();
    expect(loss.ledgerDirectionFor()).toBeUndefined();
  });

  test('assigns direct ledger directions', () => {
    expect(WagerTransaction.create(props(WagerTransactionKind.Opening)).ledgerDirectionFor()).toBe(
      LedgerDirection.Credit,
    );
    expect(WagerTransaction.create(props(WagerTransactionKind.Bet)).ledgerDirectionFor()).toBe(
      LedgerDirection.Debit,
    );
    expect(WagerTransaction.create(props(WagerTransactionKind.Win)).ledgerDirectionFor()).toBe(
      LedgerDirection.Credit,
    );
  });

  test('REFUND accepts only a BET reference and credits it', () => {
    const refund = WagerTransaction.create(props(WagerTransactionKind.Refund));
    const bet = WagerTransaction.create(props(WagerTransactionKind.Bet));
    const win = WagerTransaction.create(props(WagerTransactionKind.Win));

    expect(refund.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);
    expectDomainError(() => refund.ledgerDirectionFor(win), 'INVALID_REFERENCE_KIND');
  });

  test.each([
    [WagerTransactionKind.Bet, LedgerDirection.Credit],
    [WagerTransactionKind.Win, LedgerDirection.Debit],
    [WagerTransactionKind.Refund, LedgerDirection.Debit],
  ])('ROLLBACK inverts a processed %s direction', (referenceKind, expectedDirection) => {
    const rollback = WagerTransaction.create(props(WagerTransactionKind.Rollback));
    const reference = WagerTransaction.create(props(referenceKind));

    expect(rollback.ledgerDirectionFor(reference)).toBe(expectedDirection);
  });

  test('ROLLBACK rejects a LOSS reference', () => {
    const rollback = WagerTransaction.create(props(WagerTransactionKind.Rollback));
    const loss = WagerTransaction.create(props(WagerTransactionKind.Loss));

    expectDomainError(() => rollback.ledgerDirectionFor(loss), 'INVALID_REFERENCE_KIND');
  });

  test('rehydrates terminal persisted state without invoking transitions', () => {
    const transaction = WagerTransaction.rehydrate({
      ...props(WagerTransactionKind.Bet),
      status: WagerTransactionStatus.Rejected,
      failureCode: FailureCode.InsufficientFunds,
      referenceTransactionId: undefined,
      resultBalance: undefined,
      processedAt: undefined,
    });

    expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(transaction.failureCode).toBe(FailureCode.InsufficientFunds);
  });
});
