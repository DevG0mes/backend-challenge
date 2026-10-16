import { ApplicationError } from '../../shared/application/application.error';
import type { MoneyProps } from '../../shared/domain/money/money';
import type { LedgerDirection } from '../domain/wallet-ledger-entry';
import type { WalletRepository } from './ports/wallet.repository';

interface CursorBoundary { createdAt: string; id: string }
export interface ListLedgerQuery { cursor?: string; limit?: number }
export interface LedgerItem {
  id: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: string;
}

export class ListLedgerUseCase {
  constructor(private readonly wallets: WalletRepository) {}

  async execute(walletId: string, query: ListLedgerQuery): Promise<{ items: LedgerItem[]; nextCursor?: string }> {
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ApplicationError('INVALID_PAGE_LIMIT', 'Ledger limit must be between 1 and 100');
    }
    if (await this.wallets.findById(walletId) === null) {
      throw new ApplicationError('WALLET_NOT_FOUND', `Wallet ${walletId} was not found`);
    }
    const page = await this.wallets.listLedgerPage(walletId, this.decode(query.cursor), limit);
    const items = page.entries.map((entry) => ({
      id: entry.id,
      transactionId: entry.transactionId,
      direction: entry.direction,
      money: entry.money.toJSON(),
      balanceBefore: entry.balanceBefore.toJSON(),
      balanceAfter: entry.balanceAfter.toJSON(),
      createdAt: entry.createdAt.toISOString(),
    }));
    const last = page.entries.at(-1);
    return {
      items,
      ...(page.hasMore && last !== undefined
        ? { nextCursor: this.encode({ createdAt: last.createdAt.toISOString(), id: last.id }) }
        : {}),
    };
  }

  private encode(value: CursorBoundary): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private decode(cursor: string | undefined): { createdAt: Date; id: string } | undefined {
    if (cursor === undefined) return undefined;
    try {
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorBoundary;
      const createdAt = new Date(value.createdAt);
      if (typeof value.id !== 'string' || value.id === '' || Number.isNaN(createdAt.getTime())) throw new Error();
      return { createdAt, id: value.id };
    } catch {
      throw new ApplicationError('INVALID_CURSOR', 'Ledger cursor is invalid');
    }
  }
}
