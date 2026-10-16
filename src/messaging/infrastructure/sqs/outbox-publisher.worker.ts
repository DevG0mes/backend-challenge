import type { Clock } from '../../../shared/application/clock';
import type { PublishBatchResult } from '../../application/publish-outbox.use-case';

export interface OutboxBatchPublisher {
  execute(now: Date, batchSize: number): Promise<PublishBatchResult>;
}

export class OutboxPublisherWorker {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<unknown> | undefined;
  private polling = false;

  constructor(
    private readonly publishBatch: OutboxBatchPublisher,
    private readonly clock: Clock,
    private readonly intervalMs: number,
    private readonly batchSize: number,
  ) {}

  start(): void {
    if (this.polling) return;
    this.polling = true;
    this.schedule(0);
  }

  stopPolling(): void {
    this.polling = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  async drain(gracePeriodMs: number): Promise<boolean> {
    this.stopPolling();
    if (this.inFlight === undefined) return true;
    return Promise.race([
      this.inFlight.then(() => true, () => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), gracePeriodMs)),
    ]);
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.inFlight = this.publishBatch.execute(this.clock.now(), this.batchSize);
      void this.inFlight.finally(() => {
        this.inFlight = undefined;
        if (this.polling && this.timer === undefined) this.schedule(this.intervalMs);
      });
    }, delay);
  }
}
