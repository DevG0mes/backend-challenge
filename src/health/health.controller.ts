import { Controller, Get, Res } from '@nestjs/common';
import { ReadinessService, type ReadinessResult } from './readiness.service';

interface LivenessResponse {
  status: 'ok';
}

@Controller('health')
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get('live')
  live(): LivenessResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) response: { status(code: number): unknown }): Promise<ReadinessResult> {
    const result = await this.readiness.check();
    if (result.status === 'degraded') response.status(503);
    return result;
  }
}
