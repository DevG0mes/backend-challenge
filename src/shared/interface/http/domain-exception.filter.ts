import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../application/application.error';
import { DomainError } from '../../domain/errors/domain.error';

interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): void;
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    if (error instanceof HttpException) {
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }
    if (error instanceof ApplicationError) {
      const status = error.code === 'IDEMPOTENCY_CONFLICT'
        ? HttpStatus.CONFLICT
        : error.code === 'WALLET_NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR;
      response.status(status).json({ code: error.code, message: error.message });
      return;
    }
    if (error instanceof DomainError) {
      response.status(HttpStatus.BAD_REQUEST).json({ code: error.code, message: error.message });
      return;
    }
    if (this.databaseCode(error) === '23505') {
      response.status(HttpStatus.CONFLICT).json({ code: 'RESOURCE_CONFLICT', message: 'Resource already exists' });
      return;
    }
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
  }

  private databaseCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  }
}
