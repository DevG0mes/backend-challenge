import { Money } from '../../../shared/domain/money/money';
import { requiredObject, requiredString } from '../../../shared/interface/http/request-validation';
import type { CreateWalletCommand } from '../../application/create-wallet.use-case';

export function parseCreateWallet(body: Record<string, unknown>): CreateWalletCommand {
  const money = requiredObject(body, 'initialBalance');
  return {
    playerId: requiredString(body, 'playerId'),
    initialBalance: Money.from({ amount: requiredString(money, 'amount'), currency: requiredString(money, 'currency') }),
  };
}
