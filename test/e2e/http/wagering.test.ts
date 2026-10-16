import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../../src/app.module';

const PLAYER_ID = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';

describe('wagering HTTP API', () => {
  let app: INestApplication;
  let orm: MikroORM;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    orm = app.get(MikroORM);
    await orm.migrator.up();
  });

  beforeEach(async () => {
    await orm.em.getConnection().execute(
      'truncate outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade',
    );
  });

  afterAll(async () => app?.close());

  test('creates a wallet and processes a bet with stable replay', async () => {
    const walletResponse = await request(app.getHttpServer())
      .post('/wallets')
      .send({ playerId: PLAYER_ID, initialBalance: { amount: '100.00', currency: 'BRL' } })
      .expect(201);

    const wager = {
      providerId: 'provider-a', externalTransactionId: 'bet-1', playerId: PLAYER_ID,
      walletId: walletResponse.body.id, roundId: 'round-1', gameId: 'game-1',
      kind: 'BET', money: { amount: '25.00', currency: 'BRL' },
    };
    const first = await request(app.getHttpServer())
      .post('/wagering/transactions').set('Idempotency-Key', 'provider-a:bet-1')
      .send(wager).expect(201);
    const replay = await request(app.getHttpServer())
      .post('/wagering/transactions').set('Idempotency-Key', 'provider-a:bet-1')
      .send(wager).expect(201);

    expect(first.body.balance.amount).toBe('75.00');
    expect(first.body.idempotentReplay).toBeFalse();
    expect(replay.body).toEqual({ ...first.body, idempotentReplay: true });
  });

  test('requires idempotency and rejects malformed monetary contracts', async () => {
    await request(app.getHttpServer()).post('/wagering/transactions').send({}).expect(400);
    await request(app.getHttpServer()).post('/wallets').send({
      playerId: PLAYER_ID, initialBalance: { amount: 100, currency: 'BRL' },
    }).expect(400);
  });

  test('maps pending, business rejection, and payload conflict distinctly', async () => {
    const wallet = (await request(app.getHttpServer()).post('/wallets').send({
      playerId: PLAYER_ID, initialBalance: { amount: '10.00', currency: 'BRL' },
    })).body;
    const base = {
      providerId: 'provider-a', playerId: PLAYER_ID, walletId: wallet.id,
      roundId: 'round-1', gameId: 'game-1', money: { amount: '25.00', currency: 'BRL' },
    };

    await request(app.getHttpServer()).post('/wagering/transactions')
      .set('Idempotency-Key', 'large-bet').send({ ...base, externalTransactionId: 'large-bet', kind: 'BET' })
      .expect(422);
    await request(app.getHttpServer()).post('/wagering/transactions')
      .set('Idempotency-Key', 'refund').send({ ...base, externalTransactionId: 'refund', kind: 'REFUND', referenceExternalTransactionId: 'missing' })
      .expect(202);
    await request(app.getHttpServer()).post('/wagering/transactions')
      .set('Idempotency-Key', 'refund').send({ ...base, externalTransactionId: 'refund', kind: 'REFUND', referenceExternalTransactionId: 'other' })
      .expect(409);
  });
});
