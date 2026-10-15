export interface IntegrationEventProps<TData extends Record<string, unknown>> {
  id: string;
  occurredAt: Date;
  correlationId: string;
  causationId: string;
  data: TData;
}

export interface IntegrationEventJson<TData extends Record<string, unknown>> extends Record<string, unknown> {
  id: string;
  type: string;
  version: number;
  occurredAt: string;
  correlationId: string;
  causationId: string;
  data: TData;
}

export abstract class IntegrationEvent<TData extends Record<string, unknown>> {
  abstract readonly type: string;
  abstract readonly version: number;

  protected constructor(protected readonly props: IntegrationEventProps<TData>) {}

  get id(): string { return this.props.id; }
  get occurredAt(): Date { return new Date(this.props.occurredAt); }

  toJSON(): IntegrationEventJson<TData> {
    return {
      id: this.props.id,
      type: this.type,
      version: this.version,
      occurredAt: this.props.occurredAt.toISOString(),
      correlationId: this.props.correlationId,
      causationId: this.props.causationId,
      data: structuredClone(this.props.data),
    };
  }
}
