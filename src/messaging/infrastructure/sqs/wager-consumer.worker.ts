import { ApplicationError } from '../../../shared/application/application.error';
import type { WagerMessageEnvelope } from '../../application/consume-wager-message.use-case';
import { classifyConsumerError } from './error-classifier';
import type { ReceivedSqsMessage, SqsTransport } from './sqs.client';

export interface WagerMessageHandler {
  execute(envelope: WagerMessageEnvelope): Promise<unknown>;
}

export interface WagerConsumerOptions {
  maxReceiveCount: number;
}

export type ProcessingResult = 'EMPTY' | 'ACK' | 'RETRY' | 'DLQ';

export class WagerConsumerWorker {
  private polling = false;
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(
    private readonly transport: SqsTransport,
    private readonly handler: WagerMessageHandler,
    private readonly options: WagerConsumerOptions,
  ) {}

  start(): void {
    if (this.polling) return;
    this.polling = true;
    void this.pollLoop();
  }

  stopPolling(): void {
    this.polling = false;
  }

  async drain(gracePeriodMs: number): Promise<boolean> {
    this.stopPolling();
    if (this.inFlight.size === 0) return true;
    const completed = Promise.allSettled([...this.inFlight]).then(() => true);
    const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), gracePeriodMs));
    return Promise.race([completed, timeout]);
  }

  async processNext(): Promise<ProcessingResult> {
    const message = await this.transport.receiveOne();
    if (message === null) return 'EMPTY';
    return this.process(message);
  }

  private async process(message: ReceivedSqsMessage): Promise<ProcessingResult> {
    try {
      const envelope = this.parse(message.body);
      await this.handler.execute(envelope);
      await this.transport.acknowledge(message);
      return 'ACK';
    } catch (error) {
      if (classifyConsumerError(error) === 'PERMANENT' || message.receiveCount >= this.options.maxReceiveCount) {
        await this.transport.moveToDlq(message);
        return 'DLQ';
      }
      await this.transport.retry(message);
      return 'RETRY';
    }
  }

  private parse(body: string): WagerMessageEnvelope {
    const value: unknown = JSON.parse(body);
    if (typeof value !== 'object' || value === null || !('messageId' in value) || !('data' in value)) {
      throw new ApplicationError('INVALID_MESSAGE', 'SQS message envelope is invalid');
    }
    const envelope = value as Partial<WagerMessageEnvelope>;
    if (typeof envelope.messageId !== 'string' || typeof envelope.data !== 'object' || envelope.data === null) {
      throw new ApplicationError('INVALID_MESSAGE', 'SQS message envelope is invalid');
    }
    const data = envelope.data as unknown as Record<string, unknown>;
    const requiredStrings = [
      'providerId', 'externalTransactionId', 'idempotencyKey', 'playerId',
      'walletId', 'roundId', 'gameId', 'kind',
    ];
    const money = data.money;
    const invalidMoney = typeof money !== 'object' || money === null ||
      typeof (money as Record<string, unknown>).amount !== 'string' ||
      typeof (money as Record<string, unknown>).currency !== 'string';
    const invalidReference = data.referenceExternalTransactionId !== undefined &&
      typeof data.referenceExternalTransactionId !== 'string';
    if (requiredStrings.some((field) => typeof data[field] !== 'string' || data[field] === '') || invalidMoney || invalidReference) {
      throw new ApplicationError('INVALID_MESSAGE', 'SQS wager data is invalid');
    }
    return envelope as WagerMessageEnvelope;
  }

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      const work = this.processNext();
      this.inFlight.add(work);
      try { await work; } catch { /* transient errors are retried by SQS */ }
      finally { this.inFlight.delete(work); }
    }
  }
}
