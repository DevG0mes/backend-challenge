export enum FailureCode {
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  ReversalNegativeBalance = 'REVERSAL_NEGATIVE_BALANCE',
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  ReferenceNotProcessed = 'REFERENCE_NOT_PROCESSED',
  ReferenceMismatch = 'REFERENCE_MISMATCH',
  InvalidReferenceKind = 'INVALID_REFERENCE_KIND',
  AmountMismatch = 'AMOUNT_MISMATCH',
  AlreadyReversed = 'ALREADY_REVERSED',
  CurrencyMismatch = 'CURRENCY_MISMATCH',
  WalletMismatch = 'WALLET_MISMATCH',
  InfrastructurePermanent = 'INFRASTRUCTURE_PERMANENT',
}
