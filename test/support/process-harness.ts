import { spawn, type ChildProcess } from 'node:child_process';
import { MikroORM } from '@mikro-orm/postgresql';

import { createMikroOrmConfig } from '../../src/database/mikro-orm.config';
import { LedgerDirection } from '../../src/wallet/domain/wallet-ledger-entry';
import { Money } from '../../src/shared/domain/money/money';

export interface HttpResult<T = Record<string, unknown>> { status: number; body: T }

export class ProcessHarness {
  private readonly children: ChildProcess[] = [];
  private orm!: MikroORM;

  constructor(private readonly ports = [3101, 3102, 3103]) {}

  async start(): Promise<void> {
    this.orm = await MikroORM.init(createMikroOrmConfig({
      host: '127.0.0.1', port: Number(process.env.TEST_POSTGRES_PORT ?? '55432'),
      dbName: 'wagering', user: 'wagering', password: 'wagering',
    }));
    await this.orm.migrator.up();
    for (const [index] of this.ports.entries()) this.children[index] = this.spawnInstance(index);
    await Promise.all(this.ports.map((_, index) => this.waitUntilReady(index)));
  }

  async reset(): Promise<void> {
    await this.orm.em.getConnection().execute(
      'truncate outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade',
    );
  }

  async stop(): Promise<void> {
    for (const child of this.children) child.kill();
    await Promise.all(this.children.map((child) => new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      setTimeout(resolve, 2_000);
    })));
    this.children.length = 0;
    await this.orm.close(true);
  }

  stopInstance(index: number): void {
    this.children[index]?.kill();
  }

  async restartInstance(index: number): Promise<void> {
    const previous = this.children[index];
    if (previous && previous.exitCode === null) {
      previous.kill();
      await new Promise<void>((resolve) => previous.once('exit', () => resolve()));
    }
    this.children[index] = this.spawnInstance(index);
    await this.waitUntilReady(index);
  }

  async createWallet(playerId: string, amount = '100.00', instance = 0): Promise<Record<string, unknown>> {
    const response = await this.request(instance, '/wallets', {
      method: 'POST',
      body: JSON.stringify({ playerId, initialBalance: { amount, currency: 'BRL' } }),
    });
    if (response.status !== 201) throw new Error(`Wallet creation failed: ${response.status}`);
    return response.body;
  }

  postWager(instance: number, body: Record<string, unknown>, idempotencyKey: string): Promise<HttpResult> {
    return this.request(instance, '/wagering/transactions', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    });
  }

  async request(instance: number, path: string, init?: RequestInit): Promise<HttpResult> {
    const response = await fetch(`http://127.0.0.1:${this.ports[instance]}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  async scalar(sql: string, parameters: unknown[] = []): Promise<string> {
    const rows = await this.orm.em.getConnection().execute<{ value: string }[]>(sql, parameters);
    return rows[0]?.value ?? 'missing';
  }

  async assertWalletInvariant(walletId: string): Promise<void> {
    const instance = this.children.findIndex((child) => !child.killed && child.exitCode === null);
    if (instance < 0) throw new Error('No live application instance available for invariant check');
    const wallet = await this.request(instance, `/wallets/${walletId}`);
    let cursor: string | undefined;
    let calculated = Money.zero('BRL');
    do {
      const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
      const page = (await this.request(instance, `/wallets/${walletId}/ledger${query}`)).body as {
        items: Array<{ direction: LedgerDirection; money: { amount: string; currency: string } }>;
        nextCursor?: string;
      };
      for (const entry of page.items) {
        const money = Money.from(entry.money);
        calculated = entry.direction === LedgerDirection.Credit ? calculated.add(money) : calculated.subtract(money);
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    const stored = (wallet.body.balance as { amount: string; currency: string });
    if (!calculated.equals(Money.from(stored))) {
      throw new Error(`Wallet invariant failed: stored=${stored.amount}, ledger=${calculated.toJSON().amount}`);
    }
  }

  private async waitUntilReady(index: number): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`http://127.0.0.1:${this.ports[index]}/health/ready`)).status === 200) return;
      } catch { /* process is still booting */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Application instance ${index} did not become ready`);
  }

  private spawnInstance(index: number): ChildProcess {
    return spawn(process.execPath, ['run', 'src/main.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(this.ports[index]),
        TEST_POSTGRES_PORT: process.env.TEST_POSTGRES_PORT ?? '55432',
        SQS_ENDPOINT: process.env.SQS_ENDPOINT ?? 'http://127.0.0.1:4566',
      },
      stdio: 'ignore',
    });
  }
}

export function wager(walletId: string, playerId: string, externalTransactionId: string, amount: string) {
  return {
    providerId: 'provider-a', externalTransactionId, playerId, walletId,
    roundId: 'round-1', gameId: 'game-1', kind: 'BET', money: { amount, currency: 'BRL' },
  };
}
