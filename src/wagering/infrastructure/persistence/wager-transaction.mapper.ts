import { Money } from '../../../shared/domain/money/money';
import { FailureCode } from '../../domain/failure-code';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wager-transaction';
import { WagerTransactionRecord } from './wager-transaction.record';

export class WagerTransactionMapper {
  static toDomain(record: WagerTransactionRecord): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: record.id,
      providerId: record.providerId,
      externalTransactionId: record.externalTransactionId,
      idempotencyKey: record.idempotencyKey,
      payloadHash: record.payloadHash,
      walletId: record.walletId,
      playerId: record.playerId,
      roundId: record.roundId,
      gameId: record.gameId,
      kind: record.kind as WagerTransactionKind,
      money: Money.from({ amount: record.amount, currency: record.currency }),
      referenceExternalTransactionId: record.referenceExternalTransactionId ?? undefined,
      createdAt: record.createdAt,
      status: record.status as WagerTransactionStatus,
      referenceTransactionId: record.referenceTransactionId ?? undefined,
      failureCode: (record.failureCode as FailureCode | null | undefined) ?? undefined,
      processedAt: record.processedAt ?? undefined,
      resultBalance:
        record.resultBalance == null || record.resultCurrency == null
          ? undefined
          : Money.from({ amount: record.resultBalance, currency: record.resultCurrency }),
    });
  }

  static toRecord(transaction: WagerTransaction): WagerTransactionRecord {
    const record = new WagerTransactionRecord();
    record.id = transaction.id;
    record.providerId = transaction.providerId;
    record.externalTransactionId = transaction.externalTransactionId;
    record.idempotencyKey = transaction.idempotencyKey;
    record.payloadHash = transaction.payloadHash;
    record.walletId = transaction.walletId;
    record.playerId = transaction.playerId;
    record.roundId = transaction.roundId;
    record.gameId = transaction.gameId;
    record.kind = transaction.kind;
    record.amount = transaction.money.toJSON().amount;
    record.currency = transaction.money.currency;
    record.referenceExternalTransactionId = transaction.referenceExternalTransactionId;
    record.referenceTransactionId = transaction.referenceTransactionId;
    record.status = transaction.status;
    record.failureCode = transaction.failureCode;
    record.resultBalance = transaction.resultBalance?.toJSON().amount;
    record.resultCurrency = transaction.resultBalance?.currency;
    record.pendingAttempts = 0;
    record.nextAttemptAt = undefined;
    record.processedAt = transaction.processedAt;
    record.createdAt = transaction.createdAt;
    return record;
  }
}
