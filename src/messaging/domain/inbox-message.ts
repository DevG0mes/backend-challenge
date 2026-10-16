import { DomainError } from '../../shared/domain/errors/domain.error';

export interface ReceiveInboxMessageProps {
  consumerName: string;
  messageId: string;
  payloadHash: string;
  receivedAt: Date;
}

export interface InboxMessageState extends ReceiveInboxMessageProps {
  processedAt: Date | undefined;
}

export class InboxMessage {
  private readonly _receivedAt: Date;
  private _processedAt: Date | undefined;

  private constructor(
    public readonly consumerName: string,
    public readonly messageId: string,
    public readonly payloadHash: string,
    receivedAt: Date,
    processedAt: Date | undefined,
  ) {
    this._receivedAt = new Date(receivedAt);
    this._processedAt = processedAt === undefined ? undefined : new Date(processedAt);
  }

  static receive(props: ReceiveInboxMessageProps): InboxMessage {
    return new InboxMessage(props.consumerName, props.messageId, props.payloadHash, props.receivedAt, undefined);
  }

  static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(state.consumerName, state.messageId, state.payloadHash, state.receivedAt, state.processedAt);
  }

  get receivedAt(): Date { return new Date(this._receivedAt); }
  get processedAt(): Date | undefined { return this._processedAt === undefined ? undefined : new Date(this._processedAt); }
  isProcessed(): boolean { return this._processedAt !== undefined; }
  matchesPayload(hash: string): boolean { return this.payloadHash === hash; }

  complete(at: Date): void {
    if (this.isProcessed()) throw new DomainError('INBOX_ALREADY_COMPLETED', 'INBOX_ALREADY_COMPLETED');
    this._processedAt = new Date(at);
  }
}
