import { ApplicationError } from '../../shared/application/application.error';
import type { WagerTransaction } from '../domain/wager-transaction';
import type { WagerTransactionRepository } from './ports/wager-transaction.repository';

export class GetWagerTransactionUseCase {
  constructor(private readonly wagers: WagerTransactionRepository) {}

  async byId(id: string) {
    return this.present(await this.wagers.findById(id), `Transaction ${id} was not found`);
  }

  async byProviderExternal(providerId: string, externalTransactionId: string) {
    return this.present(
      await this.wagers.findByProviderExternal(providerId, externalTransactionId),
      `Transaction ${providerId}/${externalTransactionId} was not found`,
    );
  }

  private present(transaction: WagerTransaction | null, message: string) {
    if (transaction === null) throw new ApplicationError('TRANSACTION_NOT_FOUND', message);
    return {
      id: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      money: transaction.money.toJSON(),
      referenceExternalTransactionId: transaction.referenceExternalTransactionId,
      referenceTransactionId: transaction.referenceTransactionId,
      status: transaction.status,
      failureCode: transaction.failureCode,
      resultBalance: transaction.resultBalance?.toJSON(),
      pendingAttempts: transaction.pendingAttempts,
      nextAttemptAt: transaction.nextAttemptAt?.toISOString(),
      processedAt: transaction.processedAt?.toISOString(),
      createdAt: transaction.createdAt.toISOString(),
    };
  }
}
