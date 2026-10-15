import { BadRequestException, Body, Controller, Headers, HttpCode, Post, Res, UnprocessableEntityException, UseFilters } from '@nestjs/common';
import { DomainExceptionFilter } from '../../../shared/interface/http/domain-exception.filter';
import { ProcessWagerUseCase, type ProcessWagerResult } from '../../application/process-wager.use-case';
import { WagerTransactionStatus } from '../../domain/wager-transaction';
import { parseProcessWager } from './process-wager.dto';

interface StatusResponse {
  status(code: number): StatusResponse;
}

@Controller('wagering/transactions')
@UseFilters(DomainExceptionFilter)
export class WageringController {
  constructor(private readonly processWager: ProcessWagerUseCase) {}

  @Post()
  @HttpCode(201)
  async create(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: StatusResponse,
  ): Promise<ProcessWagerResult> {
    if (idempotencyKey === undefined || idempotencyKey.trim() === '') {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    const result = await this.processWager.execute(parseProcessWager(body, idempotencyKey));
    if (result.status === WagerTransactionStatus.Rejected) {
      throw new UnprocessableEntityException(result);
    }
    if (result.status === WagerTransactionStatus.PendingReference) response.status(202);
    return result;
  }
}
