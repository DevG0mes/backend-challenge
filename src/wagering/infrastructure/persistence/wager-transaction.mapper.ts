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
      referenceExternalTransactionId: record.referenceExternalTransactionId,
      createdAt: record.createdAt,
      status: record.status as WagerTransactionStatus,
      referenceTransactionId: record.referenceTransactionId,
      failureCode: record.failureCode as FailureCode | undefined,
      processedAt: record.processedAt,
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
    record.resultBalance = undefined;
    record.resultCurrency = undefined;
    record.pendingAttempts = 0;
    record.nextAttemptAt = undefined;
    record.processedAt = transaction.processedAt;
    record.createdAt = transaction.createdAt;
    return record;
  }
}
