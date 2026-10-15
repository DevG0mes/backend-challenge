import type { MoneyProps } from '../../../shared/domain/money/money';
import { IntegrationEvent } from '../integration-event';

interface Data extends Record<string, unknown> { transactionId: string; walletId: string; balanceBefore: MoneyProps; balanceAfter: MoneyProps; walletVersion: number; }
export interface WalletBalanceChangedEventProps extends Data { id: string; occurredAt: Date; correlationId: string; causationId: string; }

export class WalletBalanceChangedEvent extends IntegrationEvent<Data> {
  readonly type = 'WalletBalanceChanged'; readonly version = 1;
  constructor({ id, occurredAt, correlationId, causationId, ...data }: WalletBalanceChangedEventProps) {
    super({ id, occurredAt, correlationId, causationId, data });
  }
}
