import { Controller, Get, Header } from '@nestjs/common';

import { InMemoryMetrics } from './metrics';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: InMemoryMetrics) {}

  @Get()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  render(): string {
    return this.metrics.toPrometheus();
  }
}
