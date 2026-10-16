import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../../src/app.module';

const PLAYER_ID = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';

describe('query and reconciliation HTTP API', () => {
  let app: INestApplication;
  let orm: MikroORM;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    orm = app.get(MikroORM);
    await orm.migrator.up();
  });
  beforeEach(async () => orm.em.getConnection().execute('truncate outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade'));
  afterAll(async () => app.close());

  test('exposes wallet, ledger, reconciliation, and both transaction lookups', async () => {
    const wallet = (await request(app.getHttpServer()).post('/wallets').send({
      playerId: PLAYER_ID,
      initialBalance: { amount: '100.00', currency: 'BRL' },
    }).expect(201)).body;
    const transaction = (await request(app.getHttpServer()).post('/wagering/transactions')
      .set('Idempotency-Key', 'provider-a:bet-query')
      .send({ providerId: 'provider-a', externalTransactionId: 'bet-query', playerId: PLAYER_ID, walletId: wallet.id, roundId: 'round-1', gameId: 'game-1', kind: 'BET', money: { amount: '10.00', currency: 'BRL' } })
      .expect(201)).body;

    expect((await request(app.getHttpServer()).get(`/wallets/${wallet.id}`).expect(200)).body.balance.amount).toBe('90.00');
    expect((await request(app.getHttpServer()).get(`/wallets/${wallet.id}/ledger?limit=1`).expect(200)).body.nextCursor).toBeString();
    expect((await request(app.getHttpServer()).post(`/wallets/${wallet.id}/reconciliation`).expect(201)).body.consistent).toBeTrue();
    expect((await request(app.getHttpServer()).get(`/wagering/transactions/${transaction.transactionId}`).expect(200)).body.id).toBe(transaction.transactionId);
    expect((await request(app.getHttpServer()).get('/providers/provider-a/wagering/transactions/bet-query').expect(200)).body.id).toBe(transaction.transactionId);
  });

  test('rejects invalid cursors and returns not found consistently', async () => {
    const missing = '0192f291-27dd-7d3f-8071-5f8685deef37';
    await request(app.getHttpServer()).get(`/wallets/${missing}`).expect(404);
    const wallet = (await request(app.getHttpServer()).post('/wallets').send({ playerId: PLAYER_ID, initialBalance: { amount: '0.00', currency: 'BRL' } })).body;
    await request(app.getHttpServer()).get(`/wallets/${wallet.id}/ledger?cursor=not-valid`).expect(400);
    await request(app.getHttpServer()).get(`/wallets/${wallet.id}/ledger?limit=101`).expect(400);
    await request(app.getHttpServer()).get(`/wagering/transactions/${missing}`).expect(404);
  });

  test('rejects malformed database identifiers before querying PostgreSQL', async () => {
    await request(app.getHttpServer()).get('/wallets/not-a-uuid').expect(400);
    await request(app.getHttpServer()).get('/wagering/transactions/not-a-uuid').expect(400);
  });

  test('reports PostgreSQL and SQS readiness separately from liveness', async () => {
    expect((await request(app.getHttpServer()).get('/health/live').expect(200)).body).toEqual({ status: 'ok' });
    expect((await request(app.getHttpServer()).get('/health/ready').expect(200)).body).toEqual({
      status: 'ok',
      dependencies: { postgres: 'up', sqs: 'up' },
    });
  });
});
