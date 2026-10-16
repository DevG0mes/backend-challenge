import type { EntityManager } from '@mikro-orm/postgresql';

import { TransactionContext, type TransactionRunner } from './transaction-runner';

export class PostgresTransactionRunner implements TransactionRunner {
  constructor(private readonly entityManager: EntityManager) {}

  run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    return this.entityManager.fork().transactional((transactionalEntityManager) =>
      work(new TransactionContext(transactionalEntityManager)),
    );
  }
}

export function entityManagerFrom(
  context: TransactionContext,
): EntityManager {
  return context.handle as EntityManager;
}
