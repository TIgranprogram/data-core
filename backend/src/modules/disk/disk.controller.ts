import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiTags } from '@nestjs/swagger';
import { promises as fs } from 'fs';
import type { Connection } from 'mongoose';
import path from 'path';
import { Roles } from '../../common/decorators/roles.decorator';
import { diskState, type DiskSnapshot } from './disk-usage';

/** Сколько файлов обходить при подсчёте размера папки (фото — десятки тысяч, этого хватает). */
const WALK_LIMIT = 300_000;

/** Размер папки: обход без перехода по ссылкам; нечитаемое пропускается. partial — упёрлись в лимит. */
async function dirSize(dir: string) {
  let bytes = 0, files = 0, partial = false;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let list;
    try { list = await fs.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of list) {
      if (files >= WALK_LIMIT) { partial = true; break; }
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { bytes += (await fs.stat(p)).size; files++; } catch { /* удалён на ходу */ } }
    }
  }
  return { bytes, files, partial };
}
const exists = (p: string) => fs.access(p).then(() => true, () => false);

/**
 * Место на диске сервера (TASKS ДИ.1). Том с данными (`DATA_DIR` VM) смонтирован в контейнер только для чтения
 * в `HOST_DATA_DIR` (по умолч. /host-data, docker-compose.prod.yml); нет монтирования — смотрим том папки uploads.
 * Размер Mongo — из dbStats (файлы базы контейнеру не читаемы), uploads и backups — обходом папок.
 * Раз в день пишет снимок в `disk_usage_history` — из него прогноз «на сколько хватит».
 */
@Injectable()
export class DiskService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

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
    const [db, uploads, backups] = await Promise.all([
      this.connection.db!.stats().catch(() => null),
      dirSize(mounted ? path.join(host, 'uploads') : uploadsDir),
      mounted ? dirSize(path.join(host, 'backups')) : Promise.resolve(null),
    ]);
    let backupCount: number | null = null;
    if (mounted) backupCount = (await fs.readdir(path.join(host, 'backups')).catch(() => [] as string[])).filter((n) => n.startsWith('mongo-')).length;
    return {
      ...state,
      volume: mounted ? 'данные сервера (DATA_DIR)' : 'папка приложения (том с данными не подключён)',
      parts: {
        mongoBytes: db ? Number(db.storageSize ?? 0) + Number(db.indexSize ?? 0) : null,
        uploadsBytes: uploads.bytes, uploadsFiles: uploads.files,
        backupsBytes: backups?.bytes ?? null, backupCount,
      },
      checkedAt: new Date(),
    };
  }
}

/** GET /api/health/disk — только администратор и директор (ДИ.1). */
@ApiTags('Сервер')
@Controller('health')
export class DiskController {
  constructor(private readonly disk: DiskService) {}

  @Get('disk')
  @Roles('admin', 'director')
  usage() {
    return this.disk.usage();
  }
}

@Module({ controllers: [DiskController], providers: [DiskService] })
export class DiskModule {}
