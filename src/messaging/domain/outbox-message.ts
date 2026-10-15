import { DomainError } from '../../shared/domain/errors/domain.error';

export interface EnqueueOutboxMessageProps {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface OutboxMessageState extends EnqueueOutboxMessageProps {
  attempts: number;
  nextAttemptAt: Date | undefined;
  publishedAt: Date | undefined;
}

export class OutboxMessage {
  private _attempts: number;
  private _nextAttemptAt: Date | undefined;
  private _publishedAt: Date | undefined;

  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Record<string, unknown>,
    public readonly occurredAt: Date,
    attempts: number,
    nextAttemptAt: Date | undefined,
    publishedAt: Date | undefined,
  ) {
    this._attempts = attempts;
    this._nextAttemptAt = nextAttemptAt;
    this._publishedAt = publishedAt;
  }

  static enqueue(props: EnqueueOutboxMessageProps): OutboxMessage {
    return new OutboxMessage(props.id, props.aggregateId, props.eventType, structuredClone(props.payload), new Date(props.occurredAt), 0, undefined, undefined);
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(state.id, state.aggregateId, state.eventType, structuredClone(state.payload), new Date(state.occurredAt), state.attempts, state.nextAttemptAt === undefined ? undefined : new Date(state.nextAttemptAt), state.publishedAt === undefined ? undefined : new Date(state.publishedAt));
  }

  get attempts(): number { return this._attempts; }
  get nextAttemptAt(): Date | undefined { return this._nextAttemptAt === undefined ? undefined : new Date(this._nextAttemptAt); }
  get publishedAt(): Date | undefined { return this._publishedAt === undefined ? undefined : new Date(this._publishedAt); }

  isPending(): boolean { return this._publishedAt === undefined; }

  isDue(now: Date): boolean {
    return this.isPending() && (this._nextAttemptAt === undefined || this._nextAttemptAt <= now);
  }

  markPublished(at: Date): void {
    this.assertPending();
    this._publishedAt = new Date(at);
    this._nextAttemptAt = undefined;
  }

  scheduleRetry(at: Date, baseDelayMs: number, capDelayMs: number): void {
    this.assertPending();
    this._attempts += 1;
    const delay = Math.min(baseDelayMs * 2 ** (this._attempts - 1), capDelayMs);
    this._nextAttemptAt = new Date(at.getTime() + delay);
  }

  toState(): OutboxMessageState {
    return {
      id: this.id, aggregateId: this.aggregateId, eventType: this.eventType,
      payload: structuredClone(this.payload), occurredAt: new Date(this.occurredAt),
      attempts: this.attempts, nextAttemptAt: this.nextAttemptAt, publishedAt: this.publishedAt,
    };
  }

  private assertPending(): void {
    if (!this.isPending()) throw new DomainError('OUTBOX_ALREADY_PUBLISHED', 'OUTBOX_ALREADY_PUBLISHED');
  }
}
