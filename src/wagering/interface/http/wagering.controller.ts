import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Res, UnprocessableEntityException, UseFilters, UseGuards } from '@nestjs/common';
import { DomainExceptionFilter } from '../../../shared/interface/http/domain-exception.filter';
import { ProviderAuthGuard } from '../../../shared/interface/http/provider-auth.guard';
import { GetWagerTransactionUseCase } from '../../application/get-wager-transaction.use-case';
import { ProcessWagerUseCase, type ProcessWagerResult } from '../../application/process-wager.use-case';
import { WagerTransactionStatus } from '../../domain/wager-transaction';
import { parseProcessWager } from './process-wager.dto';

interface StatusResponse {
  status(code: number): StatusResponse;
}

@Controller('wagering/transactions')
@UseFilters(DomainExceptionFilter)
@UseGuards(ProviderAuthGuard)
export class WageringController {
  constructor(
    private readonly processWager: ProcessWagerUseCase,
    private readonly getTransaction: GetWagerTransactionUseCase,
  ) {}

  @Get(':transactionId')
  get(@Param('transactionId') transactionId: string) {
    return this.getTransaction.byId(transactionId);
  }

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

@Controller('providers')
@UseFilters(DomainExceptionFilter)
@UseGuards(ProviderAuthGuard)
export class ProviderWageringController {
  constructor(private readonly getTransaction: GetWagerTransactionUseCase) {}

  @Get(':providerId/wagering/transactions/:externalTransactionId')
  get(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    return this.getTransaction.byProviderExternal(providerId, externalTransactionId);
  }
}
