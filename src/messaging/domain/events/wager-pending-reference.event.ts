import type { MoneyProps } from '../../../shared/domain/money/money';
import { IntegrationEvent } from '../integration-event';

interface Data extends Record<string, unknown> { transactionId: string; walletId: string; providerId: string; referenceExternalTransactionId: string; balance: MoneyProps; }
export interface WagerPendingReferenceEventProps extends Data { id: string; occurredAt: Date; correlationId: string; causationId: string; }

export class WagerPendingReferenceEvent extends IntegrationEvent<Data> {
  readonly type = 'WagerPendingReference'; readonly version = 1;
  constructor({ id, occurredAt, correlationId, causationId, ...data }: WagerPendingReferenceEventProps) {
    super({ id, occurredAt, correlationId, causationId, data });
  }
}
