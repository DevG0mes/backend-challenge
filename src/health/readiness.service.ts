export interface HealthProbe {
  check(): Promise<void>;
}

export interface ReadinessResult {
  status: 'ok' | 'degraded';
  dependencies: { postgres: 'up' | 'down'; sqs: 'up' | 'down' };
}

export class ReadinessService {
  constructor(
    private readonly postgres: HealthProbe,
    private readonly sqs: HealthProbe,
  ) {}

  async check(): Promise<ReadinessResult> {
    const [postgres, sqs] = await Promise.allSettled([
      this.postgres.check(),
      this.sqs.check(),
    ]);
    const dependencies = {
      postgres: postgres.status === 'fulfilled' ? 'up' : 'down',
      sqs: sqs.status === 'fulfilled' ? 'up' : 'down',
    } as const;
    return {
      status: dependencies.postgres === 'up' && dependencies.sqs === 'up' ? 'ok' : 'degraded',
      dependencies,
    };
  }
}
