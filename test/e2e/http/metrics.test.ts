import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../../src/app.module';

const PLAYER_ID = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';

describe('Prometheus metrics HTTP API', () => {
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

  test('is public and exposes metrics recorded by a wager', async () => {
    const wallet = (await request(app.getHttpServer()).post('/wallets').send({
      playerId: PLAYER_ID,
      initialBalance: { amount: '100.00', currency: 'BRL' },
    }).expect(201)).body;

    await request(app.getHttpServer()).post('/wagering/transactions')
      .set('Idempotency-Key', 'provider-a:metrics-bet')
      .send({
        providerId: 'provider-a', externalTransactionId: 'metrics-bet', playerId: PLAYER_ID,
        walletId: wallet.id, roundId: 'round-1', gameId: 'game-1', kind: 'BET',
        money: { amount: '10.00', currency: 'BRL' },
      })
      .expect(201);

    const response = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('# TYPE wager_transactions_total counter');
    expect(response.text).toContain('wager_transactions_total{kind="BET",status="PROCESSED"} 1');
    expect(response.text).toContain('# TYPE wager_processing_latency_ms histogram');
  });
});
