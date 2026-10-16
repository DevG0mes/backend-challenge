import type { MoneyProps } from '../../../shared/domain/money/money';
import { IntegrationEvent } from '../integration-event';

interface Data extends Record<string, unknown> { transactionId: string; walletId: string; providerId: string; failureCode: string; balance: MoneyProps; }
export interface WagerRejectedEventProps extends Data { id: string; aggregateId: string; occurredAt: Date; correlationId: string; causationId: string; }

export class WagerRejectedEvent extends IntegrationEvent<Data> {
  readonly type = 'WagerTransactionRejected'; readonly version = 1;
  constructor({ id, aggregateId, occurredAt, correlationId, causationId, ...data }: WagerRejectedEventProps) {
    super({ id, aggregateId, occurredAt, correlationId, causationId, data });
  }
}
