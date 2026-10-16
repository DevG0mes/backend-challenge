export type DomainErrorCode =
  | 'INVALID_MONEY_AMOUNT'
  | 'INVALID_MONEY_SCALE'
  | 'INVALID_CURRENCY'
  | 'CURRENCY_MISMATCH'
  | 'NEGATIVE_INITIAL_BALANCE'
  | 'INSUFFICIENT_FUNDS'
  | 'UNBALANCED_LEDGER_ENTRY'
  | 'REFERENCE_REQUIRED'
  | 'INVALID_TRANSACTION_STATE'
  | 'INVALID_REFERENCE_KIND'
  | 'OUTBOX_ALREADY_PUBLISHED'
  | 'INBOX_ALREADY_COMPLETED';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
