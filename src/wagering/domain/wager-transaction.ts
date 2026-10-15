import { DomainError } from '../../shared/domain/errors/domain.error';
import { Money } from '../../shared/domain/money/money';
import { LedgerDirection } from '../../wallet/domain/wallet-ledger-entry';
import { FailureCode } from './failure-code';

export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId: string | undefined;
  createdAt: Date;
}

export interface WagerTransactionState extends CreateWagerTransactionProps {
  status: WagerTransactionStatus;
  referenceTransactionId: string | undefined;
  failureCode: FailureCode | undefined;
  processedAt: Date | undefined;
}

export class WagerTransaction {
  private readonly _createdAt: Date;
  private _status: WagerTransactionStatus;
  private _referenceTransactionId: string | undefined;
  private _failureCode: FailureCode | undefined;
  private _processedAt: Date | undefined;

  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    createdAt: Date,
    status: WagerTransactionStatus,
    referenceTransactionId: string | undefined,
    failureCode: FailureCode | undefined,
    processedAt: Date | undefined,
  ) {
    this._createdAt = new Date(createdAt);
    this._status = status;
    this._referenceTransactionId = referenceTransactionId;
    this._failureCode = failureCode;
    this._processedAt = processedAt === undefined ? undefined : new Date(processedAt);
  }

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (
      (props.kind === WagerTransactionKind.Refund ||
        props.kind === WagerTransactionKind.Rollback) &&
      props.referenceExternalTransactionId === undefined
    ) {
      throw new DomainError(
        'REFERENCE_REQUIRED',
        `${props.kind} requires referenceExternalTransactionId`,
      );
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt,
      WagerTransactionStatus.Pending,
      undefined,
      undefined,
      undefined,
    );
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
    );
  }

  get createdAt(): Date {
    return new Date(this._createdAt);
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt === undefined ? undefined : new Date(this._processedAt);
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNotTerminal();

    if (this.requiresReference() && referenceTransactionId === undefined) {
      throw new DomainError('REFERENCE_REQUIRED', `${this.kind} requires a resolved reference`);
    }

    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = new Date(at);
  }

  markPendingReference(): void {
    this.assertNotTerminal();

    if (this._status !== WagerTransactionStatus.Pending) {
      throw new DomainError(
        'INVALID_TRANSACTION_STATE',
        `Cannot mark ${this._status} as pending reference`,
      );
    }

    this._status = WagerTransactionStatus.PendingReference;
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
  }

  fail(code: FailureCode): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
  }

  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund || this.kind === WagerTransactionKind.Rollback
    );
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection | undefined {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Loss:
        return undefined;
      case WagerTransactionKind.Refund:
        this.assertReferenceKind(reference, [WagerTransactionKind.Bet]);
        return LedgerDirection.Credit;
      case WagerTransactionKind.Rollback:
        this.assertReferenceKind(reference, [
          WagerTransactionKind.Bet,
          WagerTransactionKind.Win,
          WagerTransactionKind.Refund,
        ]);
        return reference?.kind === WagerTransactionKind.Bet
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;
    }
  }

  private assertNotTerminal(): void {
    if (this.isTerminal()) {
      throw new DomainError(
        'INVALID_TRANSACTION_STATE',
        `Transaction in terminal state ${this._status} cannot transition`,
      );
    }
  }

  private assertReferenceKind(
    reference: WagerTransaction | undefined,
    acceptedKinds: readonly WagerTransactionKind[],
  ): asserts reference is WagerTransaction {
    if (reference === undefined) {
      throw new DomainError('REFERENCE_REQUIRED', `${this.kind} requires a reference`);
    }

    if (!acceptedKinds.includes(reference.kind)) {
      throw new DomainError(
        'INVALID_REFERENCE_KIND',
        `${this.kind} cannot reference ${reference.kind}`,
      );
    }
  }
}
