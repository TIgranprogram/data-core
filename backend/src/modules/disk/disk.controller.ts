import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiTags } from '@nestjs/swagger';
import { promises as fs } from 'fs';
import type { Connection } from 'mongoose';
import path from 'path';
import { AuditModule } from '../audit/audit.module';
import { Roles } from '../../common/decorators/roles.decorator';
import { diskState, type DiskSnapshot } from './disk-usage';
import { dirSize, exists } from './disk-fs';
import { BackupsController } from './backups.controller';
import { BundleController } from './bundle.controller';
import { IntegrityService } from './integrity';
import { OffsiteService } from './offsite';
import { OffsiteController } from './offsite.controller';
import { slowSummary } from '../../common/interceptors/slow-request.interceptor';

/**
 * Место на диске сервера (TASKS ДИ.1). Том с данными (`DATA_DIR` VM) смонтирован в контейнер только для чтения
 * в `HOST_DATA_DIR` (по умолч. /host-data, docker-compose.prod.yml); нет монтирования — смотрим том папки uploads.
 * Размер Mongo — из dbStats (файлы базы контейнеру не читаемы), uploads и backups — обходом папок.
 * Раз в день пишет снимок в `disk_usage_history` — из него прогноз «на сколько хватит».
 */
@Injectable()
export class DiskService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** Тяжёлые части (обход папок, dbStats) — не чаще раза в час, между расчётами из памяти (раньше запрос шёл ~10 с). */
  private heavy?: { at: number; key: string; parts: Record<string, number | null> };
  private static readonly HEAVY_TTL_MS = 3600_000;

  private async heavyParts(mounted: boolean, host: string, uploadsDir: string) {
    const key = `${mounted}:${host}`;
    if (this.heavy && this.heavy.key === key && Date.now() - this.heavy.at < DiskService.HEAVY_TTL_MS) return this.heavy.parts;
    const [db, uploads, backups] = await Promise.all([
      this.connection.db!.stats().catch(() => null),
      dirSize(mounted ? path.join(host, 'uploads') : uploadsDir),
      mounted ? dirSize(path.join(host, 'backups')) : Promise.resolve(null),
    ]);
    let backupCount: number | null = null;
    if (mounted) backupCount = (await fs.readdir(path.join(host, 'backups')).catch(() => [] as string[])).filter((n) => n.startsWith('mongo-')).length;
    const parts = {
      mongoBytes: db ? Number(db.storageSize ?? 0) + Number(db.indexSize ?? 0) : null,
      uploadsBytes: uploads.bytes, uploadsFiles: uploads.files,
      backupsBytes: backups?.bytes ?? null, backupCount,
    };
    this.heavy = { at: Date.now(), key, parts };
    return parts;
  }

  async usage() {
    const host = process.env.HOST_DATA_DIR || '/host-data';
    const mounted = await exists(host);
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const root = mounted ? host : (await exists(uploadsDir)) ? uploadsDir : process.cwd();
    const st = await fs.statfs(root);
    const total = st.blocks * st.bsize, free = st.bavail * st.bsize;
    const today = new Date().toISOString().slice(0, 10);
    const hist = this.connection.db!.collection<DiskSnapshot & { _id: string }>('disk_usage_history');
    const history = await hist.find({}, { projection: { _id: 0 } }).sort({ date: -1 }).limit(60).toArray();
    const state = diskState(total, free, history, today);
    await hist.updateOne({ _id: today }, { $set: { date: today, usedBytes: state.usedBytes, totalBytes: total } }, { upsert: true });
    const parts = await this.heavyParts(mounted, host, uploadsDir);
    return {
      ...state,
      volume: mounted ? 'данные сервера (DATA_DIR)' : 'папка приложения (том с данными не подключён)',
      parts,
      checkedAt: new Date(),
    };
  }
}

/** GET /api/health/disk — только администратор и директор (ДИ.1). */
@ApiTags('Сервер')
@Controller('health')
export class DiskController {
  constructor(private readonly disk: DiskService, private readonly integrity: IntegrityService) {}

  @Get('disk')
  @Roles('admin', 'director')
  usage() {
    return this.disk.usage();
  }

  /** А1: GET /api/health/integrity — проблемы в данных склада (только чтение); ?fresh=1 — пересчитать сейчас. */
  @Get('integrity')
  @Roles('admin', 'director')
  integrityReport(@Query('fresh') fresh?: string) {
    return this.integrity.report(fresh === '1');
  }

  /** А4: GET /api/health/slow — запросы дольше 1 с с последнего запуска, по маршрутам. */
  @Get('slow')
  @Roles('admin', 'director')
  slow() {
    return slowSummary();
  }
}

@Module({ imports: [AuditModule], controllers: [DiskController, BackupsController, BundleController, OffsiteController], providers: [DiskService, IntegrityService, OffsiteService], exports: [IntegrityService] })
export class DiskModule {}
