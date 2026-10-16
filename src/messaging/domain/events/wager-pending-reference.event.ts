import type { MoneyProps } from '../../../shared/domain/money/money';
import { IntegrationEvent } from '../integration-event';

interface Data extends Record<string, unknown> { transactionId: string; walletId: string; providerId: string; referenceExternalTransactionId: string; balance: MoneyProps; }
export interface WagerPendingReferenceEventProps extends Data { id: string; aggregateId: string; occurredAt: Date; correlationId: string; causationId: string; }

export class WagerPendingReferenceEvent extends IntegrationEvent<Data> {
  readonly type = 'WagerTransactionPendingReference'; readonly version = 1;
  constructor({ id, aggregateId, occurredAt, correlationId, causationId, ...data }: WagerPendingReferenceEventProps) {
    super({ id, aggregateId, occurredAt, correlationId, causationId, data });
  }
}
