import { ApplicationError } from '../../shared/application/application.error';
import type { MoneyProps } from '../../shared/domain/money/money';
import type { WalletRepository } from './ports/wallet.repository';

export interface WalletDetails {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export class GetWalletUseCase {
  constructor(private readonly wallets: WalletRepository) {}

  async execute(walletId: string): Promise<WalletDetails> {
    const wallet = await this.wallets.findById(walletId);
    if (wallet === null) throw new ApplicationError('WALLET_NOT_FOUND', `Wallet ${walletId} was not found`);
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }
}
