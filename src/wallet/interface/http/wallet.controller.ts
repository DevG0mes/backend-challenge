import { Body, Controller, Post, UseFilters } from '@nestjs/common';

import { DomainExceptionFilter } from '../../../shared/interface/http/domain-exception.filter';
import { CreateWalletUseCase, type WalletResult } from '../../application/create-wallet.use-case';
import { parseCreateWallet } from './create-wallet.dto';

@Controller('wallets')
@UseFilters(DomainExceptionFilter)
export class WalletController {
  constructor(private readonly createWallet: CreateWalletUseCase) {}

  @Post()
  create(@Body() body: Record<string, unknown>): Promise<WalletResult> {
    return this.createWallet.execute(parseCreateWallet(body));
  }
}
