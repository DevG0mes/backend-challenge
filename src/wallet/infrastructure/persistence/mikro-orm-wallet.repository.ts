import { LockMode, QueryOrder } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { entityManagerFrom } from '../../../database/postgres-transaction-runner';
import type { TransactionContext } from '../../../database/transaction-runner';
import type { WalletRepository } from '../../application/ports/wallet.repository';
import type { WalletLedgerEntry } from '../../domain/wallet-ledger-entry';
import type { Wallet } from '../../domain/wallet';
import { LedgerEntryMapper } from './ledger-entry.mapper';
import { LedgerEntryRecord } from './ledger-entry.record';
import { WalletMapper } from './wallet.mapper';
import { WalletRecord } from './wallet.record';

export class MikroOrmWalletRepository implements WalletRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async findById(id: string, context?: TransactionContext): Promise<Wallet | null> {
    const record = await this.manager(context).findOne(WalletRecord, { id });
    return record === null ? null : WalletMapper.toDomain(record);
  }

  async findOneForUpdate(id: string, context: TransactionContext): Promise<Wallet | null> {
    const record = await entityManagerFrom(context).findOne(
      WalletRecord,
      { id },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    return record === null ? null : WalletMapper.toDomain(record);
  }

  async save(wallet: Wallet, context: TransactionContext): Promise<void> {
    await entityManagerFrom(context).upsert(WalletRecord, WalletMapper.toRecord(wallet));
  }

  async appendLedger(
    entry: WalletLedgerEntry,
    context: TransactionContext,
  ): Promise<void> {
    entityManagerFrom(context).persist(LedgerEntryMapper.toRecord(entry));
  }

  async listLedger(
    walletId: string,
    context?: TransactionContext,
  ): Promise<WalletLedgerEntry[]> {
    const records = await this.manager(context).find(
      LedgerEntryRecord,
      { walletId },
      { orderBy: { createdAt: QueryOrder.ASC, id: QueryOrder.ASC } },
    );
    return records.map(LedgerEntryMapper.toDomain);
  }

  private manager(context?: TransactionContext): EntityManager {
    return context === undefined ? this.entityManager.fork() : entityManagerFrom(context);
  }
}
