import { BadRequestException } from '@nestjs/common';

import { Money } from '../../../shared/domain/money/money';
import { requiredObject, requiredString } from '../../../shared/interface/http/request-validation';
import type { ProcessWagerCommand } from '../../application/process-wager.use-case';
import { WagerTransactionKind } from '../../domain/wager-transaction';

export function parseProcessWager(body: Record<string, unknown>, idempotencyKey: string): ProcessWagerCommand {
  const kind = requiredString(body, 'kind') as WagerTransactionKind;
  if (![WagerTransactionKind.Bet, WagerTransactionKind.Win, WagerTransactionKind.Loss, WagerTransactionKind.Refund, WagerTransactionKind.Rollback].includes(kind)) {
    throw new BadRequestException('kind is invalid');
  }
  const money = requiredObject(body, 'money');
  const reference = body.referenceExternalTransactionId;
  if (reference !== undefined && typeof reference !== 'string') {
    throw new BadRequestException('referenceExternalTransactionId must be a string');
  }
  return {
    providerId: requiredString(body, 'providerId'),
    externalTransactionId: requiredString(body, 'externalTransactionId'),
    idempotencyKey,
    playerId: requiredString(body, 'playerId'),
    walletId: requiredString(body, 'walletId'),
    roundId: requiredString(body, 'roundId'),
    gameId: requiredString(body, 'gameId'),
    kind,
    money: Money.from({ amount: requiredString(money, 'amount'), currency: requiredString(money, 'currency') }),
    referenceExternalTransactionId: reference,
  };
}
