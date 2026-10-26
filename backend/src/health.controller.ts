import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  HealthCheckResult,
  MongooseHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
  HealthCheckError,
} from '@nestjs/terminus';
import { Public } from './common/decorators/public.decorator';
import { backupsRoot, latestBackupDate } from './modules/disk/backups';

/** А3: бэкап старше 30 ч (cron 03:00 не отработал) — /health красный. Папка копий не подключена (локально) — не проверяем. */
export const BACKUP_MAX_AGE_H = 30;
export function backupAgeCheck(latestDate: string | null | undefined, now = Date.now()): HealthIndicatorResult {
  if (latestDate === undefined) return { backup: { status: 'up', note: 'папка копий не подключена' } };
  if (latestDate === null) return { backup: { status: 'down', message: 'копий нет' } };
  const ageH = Math.round((now - new Date(latestDate).getTime()) / 36e5);
  return { backup: { status: ageH <= BACKUP_MAX_AGE_H ? 'up' : 'down', last: latestDate, ageHours: ageH } };
}

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
      async () => {
        const r = backupAgeCheck(await latestBackupDate(backupsRoot()));
        if (r.backup.status === 'down') throw new HealthCheckError('backup', r);
        return r;
      },
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
