import type { MoneyProps } from '../../../shared/domain/money/money';
import { IntegrationEvent } from '../integration-event';

export interface WagerProcessedEventProps {
  id: string;
  occurredAt: Date;
  correlationId: string;
  causationId: string;
  transactionId: string;
  walletId: string;
  providerId: string;
  status: string;
  balance: MoneyProps;
}

interface WagerProcessedData extends Record<string, unknown> {
  transactionId: string;
  walletId: string;
  providerId: string;
  status: string;
  balance: MoneyProps;
}

export class WagerProcessedEvent extends IntegrationEvent<WagerProcessedData> {
  readonly type = 'WagerProcessed';
  readonly version = 1;

  constructor(props: WagerProcessedEventProps) {
    super({
      id: props.id,
      occurredAt: props.occurredAt,
      correlationId: props.correlationId,
      causationId: props.causationId,
      data: {
        transactionId: props.transactionId,
        walletId: props.walletId,
        providerId: props.providerId,
        status: props.status,
        balance: props.balance,
      },
    });
  }
}
