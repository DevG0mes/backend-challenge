export class TransactionContext {
  constructor(public readonly handle: unknown) {}
}

export interface TransactionRunner {
  run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}
