import type { TransactionRunner } from '../../database/transaction-runner';
import { ApplicationError } from '../../shared/application/application.error';
import { canonicalJson } from '../../shared/application/canonical-json';
import type { Clock } from '../../shared/application/clock';
import { Money, type MoneyProps } from '../../shared/domain/money/money';
import { ProcessWagerUseCase, type ProcessWagerResult } from '../../wagering/application/process-wager.use-case';
import type { WagerTransactionKind } from '../../wagering/domain/wager-transaction';
import type { InboxRepository } from './ports/inbox.repository';
import { InboxMessage } from '../domain/inbox-message';
import { createHash } from 'node:crypto';

export interface WagerMessageEnvelope {
  messageId: string;
  data: {
    providerId: string; externalTransactionId: string; idempotencyKey: string;
    playerId: string; walletId: string; roundId: string; gameId: string;
    kind: WagerTransactionKind; money: MoneyProps; referenceExternalTransactionId?: string;
  };
}

export interface ConsumeWagerResult { duplicate: boolean; wager: ProcessWagerResult; }

export class ConsumeWagerMessageUseCase {
  private static readonly CONSUMER = 'wager-consumer';

  constructor(
    private readonly transactions: TransactionRunner,
    private readonly inbox: InboxRepository,
    private readonly processWager: ProcessWagerUseCase,
    private readonly clock: Clock,
  ) {}

  async execute(envelope: WagerMessageEnvelope): Promise<ConsumeWagerResult> {
    const hash = createHash('sha256').update(canonicalJson(envelope.data)).digest('hex');
    try {
      return await this.transactions.run(async (context) => {
        const existing = await this.inbox.find(ConsumeWagerMessageUseCase.CONSUMER, envelope.messageId, context);
        if (existing !== null) return this.duplicate(existing.payloadHash, hash, envelope, context);

        await this.inbox.insert({ consumerName: ConsumeWagerMessageUseCase.CONSUMER, messageId: envelope.messageId, payloadHash: hash, receivedAt: this.clock.now(), processedAt: undefined }, context);
        const wager = await this.processWager.execute(this.command(envelope), context);
        await this.inbox.markProcessed(ConsumeWagerMessageUseCase.CONSUMER, envelope.messageId, this.clock.now(), context);
        return { duplicate: false, wager };
      });
    } catch (error) {
      const existing = await this.transactions.run((context) => this.inbox.find(ConsumeWagerMessageUseCase.CONSUMER, envelope.messageId, context));
      if (existing !== null) return this.duplicate(existing.payloadHash, hash, envelope);
      throw error;
    }
  }

  private async duplicate(
    storedHash: string,
    receivedHash: string,
    envelope: WagerMessageEnvelope,
    context?: import('../../database/transaction-runner').TransactionContext,
  ): Promise<ConsumeWagerResult> {
    if (storedHash !== receivedHash) throw new ApplicationError('INBOX_PAYLOAD_CONFLICT', 'Message ID was already used with another payload');
    const wager = await this.processWager.execute(this.command(envelope), context);
    return { duplicate: true, wager };
  }

  private command(envelope: WagerMessageEnvelope) {
    return {
      ...envelope.data,
      money: Money.from(envelope.data.money),
      referenceExternalTransactionId: envelope.data.referenceExternalTransactionId,
    };
  }
}
