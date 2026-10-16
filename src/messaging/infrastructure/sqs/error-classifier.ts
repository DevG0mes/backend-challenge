import { ApplicationError } from '../../../shared/application/application.error';
import { DomainError } from '../../../shared/domain/errors/domain.error';

export type ErrorDisposition = 'PERMANENT' | 'TRANSIENT';

export function classifyConsumerError(error: unknown): ErrorDisposition {
  if (error instanceof SyntaxError || error instanceof DomainError) return 'PERMANENT';
  if (error instanceof ApplicationError) {
    return error.code === 'INBOX_PAYLOAD_CONFLICT' || error.code === 'IDEMPOTENCY_CONFLICT' || error.code === 'INVALID_MESSAGE'
      ? 'PERMANENT'
      : 'TRANSIENT';
  }
  return 'TRANSIENT';
}
