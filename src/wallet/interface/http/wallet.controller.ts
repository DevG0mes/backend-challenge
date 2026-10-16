import { Body, Controller, Get, Param, Post, Query, UseFilters, UseGuards } from '@nestjs/common';

import { DomainExceptionFilter } from '../../../shared/interface/http/domain-exception.filter';
import { ProviderAuthGuard } from '../../../shared/interface/http/provider-auth.guard';
import { CreateWalletUseCase, type WalletResult } from '../../application/create-wallet.use-case';
import { GetWalletUseCase } from '../../application/get-wallet.use-case';
import { ListLedgerUseCase } from '../../application/list-ledger.use-case';
import { ReconcileWalletUseCase } from '../../application/reconcile-wallet.use-case';
import { parseCreateWallet } from './create-wallet.dto';

@Controller('wallets')
@UseFilters(DomainExceptionFilter)
@UseGuards(ProviderAuthGuard)
export class WalletController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
    private readonly listLedger: ListLedgerUseCase,
    private readonly reconcileWallet: ReconcileWalletUseCase,
  ) {}

  @Post()
  create(@Body() body: Record<string, unknown>): Promise<WalletResult> {
    return this.createWallet.execute(parseCreateWallet(body));
  }

  @Get(':walletId')
  get(@Param('walletId') walletId: string) {
    return this.getWallet.execute(walletId);
  }

  @Get(':walletId/ledger')
  ledger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.listLedger.execute(walletId, {
      ...(cursor === undefined ? {} : { cursor }),
      ...(limit === undefined ? {} : { limit: Number(limit) }),
    });
  }

  @Post(':walletId/reconciliation')
  reconcile(@Param('walletId') walletId: string) {
    return this.reconcileWallet.execute(walletId);
  }
}
