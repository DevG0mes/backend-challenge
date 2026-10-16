import { LedgerDirection } from '../../wallet/domain/wallet-ledger-entry';
import { Wallet } from '../../wallet/domain/wallet';
import { FailureCode } from './failure-code';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from './wager-transaction';

export type WagerDecision =
  | {
      type: 'APPLY';
      direction: LedgerDirection | undefined;
      referenceTransactionId: string | undefined;
    }
  | { type: 'PENDING_REFERENCE' }
  | { type: 'REJECT'; failureCode: FailureCode };

export function evaluateWager(
  transaction: WagerTransaction,
  wallet: Wallet,
  reference?: WagerTransaction,
  priorReversals: readonly WagerTransaction[] = [],
): WagerDecision {
  if (transaction.walletId !== wallet.id || transaction.playerId !== wallet.playerId) {
    return reject(FailureCode.WalletMismatch);
  }

  if (transaction.money.currency !== wallet.currency) {
    return reject(FailureCode.CurrencyMismatch);
  }

  if (!transaction.requiresReference()) {
    if (
      transaction.kind === WagerTransactionKind.Bet &&
      wallet.balance.isLessThan(transaction.money)
    ) {
      return reject(FailureCode.InsufficientFunds);
    }

    return apply(transaction.ledgerDirectionFor(), undefined);
  }

  if (reference === undefined) {
    return { type: 'PENDING_REFERENCE' };
  }

  if (reference.status !== WagerTransactionStatus.Processed) {
    return reject(FailureCode.ReferenceNotProcessed);
  }

  if (
    transaction.referenceExternalTransactionId !== reference.externalTransactionId ||
    transaction.providerId !== reference.providerId ||
    transaction.playerId !== reference.playerId ||
    transaction.walletId !== reference.walletId ||
    transaction.roundId !== reference.roundId
  ) {
    return reject(FailureCode.ReferenceMismatch);
  }

  if (transaction.money.currency !== reference.money.currency) {
    return reject(FailureCode.CurrencyMismatch);
  }

  if (!transaction.money.equals(reference.money)) {
    return reject(FailureCode.AmountMismatch);
  }

  if (!isAcceptedReferenceKind(transaction.kind, reference.kind)) {
    return reject(FailureCode.InvalidReferenceKind);
  }

  if (
    priorReversals.some(
      (existing) =>
        existing.kind === transaction.kind &&
        existing.referenceTransactionId === reference.id &&
        existing.status === WagerTransactionStatus.Processed,
    )
  ) {
    return reject(FailureCode.AlreadyReversed);
  }

  const direction = transaction.ledgerDirectionFor(reference);
  if (
    direction === LedgerDirection.Debit &&
    wallet.balance.isLessThan(transaction.money)
  ) {
    return reject(FailureCode.ReversalNegativeBalance);
  }

  return apply(direction, reference.id);
}

function isAcceptedReferenceKind(
  transactionKind: WagerTransactionKind,
  referenceKind: WagerTransactionKind,
): boolean {
  if (transactionKind === WagerTransactionKind.Refund) {
    return referenceKind === WagerTransactionKind.Bet;
  }

  return (
    referenceKind === WagerTransactionKind.Bet ||
    referenceKind === WagerTransactionKind.Win ||
    referenceKind === WagerTransactionKind.Refund
  );
}

function apply(
  direction: LedgerDirection | undefined,
  referenceTransactionId: string | undefined,
): WagerDecision {
  return { type: 'APPLY', direction, referenceTransactionId };
}

function reject(failureCode: FailureCode): WagerDecision {
  return { type: 'REJECT', failureCode };
}
