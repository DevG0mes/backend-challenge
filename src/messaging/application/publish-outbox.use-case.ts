import type { TransactionRunner } from '../../database/transaction-runner';
import type { OutboxRecordData, OutboxRepository } from './ports/outbox.repository';
import type { OperationalMetrics } from '../../shared/observability/metrics';

export interface OutboxEventPublisher {
  publish(message: OutboxRecordData): Promise<void>;
}

export interface PublishOutboxOptions {
  baseRetryMs: number;
  maxRetryMs: number;
  leaseMs: number;
}

export interface PublishBatchResult {
  claimed: number;
  published: number;
  failed: number;
  oldestLagMs: number;
}

export class PublishOutboxBatchUseCase {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly outbox: OutboxRepository,
    private readonly publisher: OutboxEventPublisher,
    private readonly options: PublishOutboxOptions,
    private readonly metrics?: OperationalMetrics,
  ) {}

  async execute(now: Date, batchSize: number): Promise<PublishBatchResult> {
    const leaseUntil = new Date(now.getTime() + this.options.leaseMs);
    const claimed = await this.transactions.run((context) =>
      this.outbox.claimDue(now, batchSize, leaseUntil, context),
    );
    const result: PublishBatchResult = {
      claimed: claimed.length,
      published: 0,
      failed: 0,
      oldestLagMs: claimed.length === 0
        ? 0
        : Math.max(...claimed.map((message) => Math.max(0, now.getTime() - message.occurredAt.getTime()))),
    };
    this.metrics?.setGauge('outbox_lag_seconds', result.oldestLagMs / 1_000);

    for (const message of claimed) {
      try {
        await this.publisher.publish(message);
        message.publishedAt = now;
        message.nextAttemptAt = undefined;
        result.published += 1;
      } catch {
        message.attempts += 1;
        const delay = Math.min(
          this.options.baseRetryMs * 2 ** (message.attempts - 1),
          this.options.maxRetryMs,
        );
        message.nextAttemptAt = new Date(now.getTime() + delay);
        result.failed += 1;
        this.metrics?.increment('outbox_retries_total', { eventType: message.eventType });
      }
      await this.transactions.run((context) => this.outbox.save(message, context));
    }

    return result;
  }
}
