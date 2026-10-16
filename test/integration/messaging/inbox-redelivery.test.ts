import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import { createMikroOrmConfig } from '../../../src/database/mikro-orm.config';
import { PostgresTransactionRunner } from '../../../src/database/postgres-transaction-runner';
import { ConsumeWagerMessageUseCase, type WagerMessageEnvelope } from '../../../src/messaging/application/consume-wager-message.use-case';
import { MikroOrmInboxRepository } from '../../../src/messaging/infrastructure/persistence/mikro-orm-inbox.repository';
import { MikroOrmOutboxRepository } from '../../../src/messaging/infrastructure/persistence/mikro-orm-outbox.repository';
import { RandomIdGenerator } from '../../../src/shared/application/id-generator';
import { Money } from '../../../src/shared/domain/money/money';
import { CreateWalletUseCase } from '../../../src/wallet/application/create-wallet.use-case';
import { MikroOrmWalletRepository } from '../../../src/wallet/infrastructure/persistence/mikro-orm-wallet.repository';
import { ProcessWagerUseCase } from '../../../src/wagering/application/process-wager.use-case';
import { WagerTransactionKind } from '../../../src/wagering/domain/wager-transaction';
import { MikroOrmWagerTransactionRepository } from '../../../src/wagering/infrastructure/persistence/mikro-orm-wager-transaction.repository';

const PLAYER_ID = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';
const NOW = new Date('2026-10-15T12:00:00.000Z');

describe('persistent inbox redelivery', () => {
  let orm: MikroORM;
  let consume: ConsumeWagerMessageUseCase;
  let createWallet: CreateWalletUseCase;
  let walletId: string;

  beforeAll(async () => {
    orm = await MikroORM.init(createMikroOrmConfig({ host: '127.0.0.1', port: Number(process.env.TEST_POSTGRES_PORT ?? '55432'), dbName: 'wagering', user: 'wagering', password: 'wagering' }));
    await orm.migrator.up();
    const transactions = new PostgresTransactionRunner(orm.em);
    const wallets = new MikroOrmWalletRepository(orm.em);
    const wagers = new MikroOrmWagerTransactionRepository(orm.em);
    const outbox = new MikroOrmOutboxRepository(orm.em);
    const ids = new RandomIdGenerator();
    const clock = { now: () => NOW };
    const processWager = new ProcessWagerUseCase(transactions, wallets, wagers, outbox, ids, clock);
    consume = new ConsumeWagerMessageUseCase(transactions, new MikroOrmInboxRepository(orm.em), processWager, clock);
    createWallet = new CreateWalletUseCase(transactions, wallets, wagers, outbox, ids, clock);
  });

  beforeEach(async () => {
    await orm.em.getConnection().execute('truncate outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade');
    walletId = (await createWallet.execute({ playerId: PLAYER_ID, initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }) })).id;
    await orm.em.getConnection().execute('truncate outbox_messages');
  });

  afterAll(async () => orm.close(true));

  test('commits inbox, financial result, ledger, and outbox atomically', async () => {
    const result = await consume.execute(envelope());
    expect(result.duplicate).toBeFalse();
    expect(result.wager.balance.amount).toBe('75.00');
    expect(await count('inbox_messages')).toBe('1');
    expect(await count('wallet_ledger_entries')).toBe('2');
    expect(await count('outbox_messages')).toBe('2');
  });

  test('rolls back the inbox when financial processing cannot commit', async () => {
    const invalid = envelope();
    invalid.data.walletId = '0192f291-27dd-7d3f-8071-5f8685deef99';
    await expect(consume.execute(invalid)).rejects.toThrow('WALLET_NOT_FOUND');
    expect(await count('inbox_messages')).toBe('0');
    expect(await count('outbox_messages')).toBe('0');
    expect(await count('wallet_ledger_entries')).toBe('1');
  });

  test('acknowledges an identical completed duplicate without another effect', async () => {
    await consume.execute(envelope());
    const replay = await consume.execute(envelope());
    expect(replay.duplicate).toBeTrue();
    expect(await count('wallet_ledger_entries')).toBe('2');
  });

  test('rejects a duplicate message ID carrying a divergent payload', async () => {
    await consume.execute(envelope());
    const divergent = envelope();
    divergent.data.money.amount = '26.00';
    await expect(consume.execute(divergent)).rejects.toThrow('INBOX_PAYLOAD_CONFLICT');
    expect(await count('wallet_ledger_entries')).toBe('2');
  });

  test('settles concurrent duplicate delivery exactly once', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => consume.execute(envelope())));
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(results.filter((result) => result.duplicate)).toHaveLength(9);
    expect(await count('wallet_ledger_entries')).toBe('2');
  });

  function envelope(): WagerMessageEnvelope {
    return { messageId: 'message-1', data: { providerId: 'provider-a', externalTransactionId: 'bet-message-1', idempotencyKey: 'provider-a:bet-message-1', playerId: PLAYER_ID, walletId, roundId: 'round-1', gameId: 'game-1', kind: WagerTransactionKind.Bet, money: { amount: '25.00', currency: 'BRL' } } };
  }

  async function count(table: string): Promise<string> {
    const rows = await orm.em.getConnection().execute<{ count: string }[]>(`select count(*)::text as count from ${table}`);
    return rows[0]?.count ?? 'missing';
  }
});
