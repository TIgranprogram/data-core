import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  HealthCheckResult,
  MongooseHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { Public } from './common/decorators/public.decorator';

@Public()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly health: HealthCheckService,
    private readonly mongo: MongooseHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.mongo.pingCheck('mongo', { timeout: 1000 }) as Promise<HealthIndicatorResult>,
      () => this.memory.checkRSS('memory', 512 * 1024 * 1024), // 512 MB RSS
      () => this.disk.checkStorage('disk', { path: process.cwd(), thresholdPercent: 90 }),
    ]);
  }

  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.mongo.pingCheck('mongo', { timeout: 1000 }) as Promise<HealthIndicatorResult>,
    ]);
  }

  @Get('live')
  live() {
    return { status: 'ok', uptime: Math.floor((Date.now() - this.startedAt) / 1000) };
  }
}
