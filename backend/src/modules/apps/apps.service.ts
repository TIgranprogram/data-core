import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream, existsSync, promises as fs, ReadStream } from 'fs';
import { join } from 'path';
import { uploadsRoot } from '../../common/uploads/safe-path';

export const PDM_LOADER_FILE = 'DataCore.PdmLoader.exe';
/** Версия — только три числа через точку: так в путь не попадает ничего лишнего. */
export const VERSION_RE = /^\d+\.\d+\.\d+$/;
const NOT_READY = 'Приложение ещё не выложено';

export interface AppInfo { version: string; size: number; sha256: string; uploadedAt: string }

/** Сравнение semver по трём числам (не по строке: 1.10.0 старше 1.9.0). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** Приложения для скачивания: `uploads/apps/pdm-loader/<версия>/DataCore.PdmLoader.exe` + `meta.json`. Файлы кладёт выкладка, не API. */
@Injectable()
export class AppsService {
  private dir(): string {
    return join(uploadsRoot(), 'apps', 'pdm-loader');
  }

  /** Старшая версия, у которой есть файл. */
  private async latest(): Promise<{ version: string; file: string; dir: string }> {
    let names: string[] = [];
    try { names = await fs.readdir(this.dir()); } catch { /* папки нет — приложение не выложено */ }
    const versions = names.filter((n) => VERSION_RE.test(n) && existsSync(join(this.dir(), n, PDM_LOADER_FILE))).sort(compareVersions);
    const version = versions[versions.length - 1];
    if (!version) throw new NotFoundException(NOT_READY);
    const dir = join(this.dir(), version);
    return { version, dir, file: join(dir, PDM_LOADER_FILE) };
  }

  async info(): Promise<AppInfo> {
    const { version, dir, file } = await this.latest();
    const stat = await fs.stat(file);
    let meta: { sha256?: unknown; uploadedAt?: unknown } = {};
    try { meta = JSON.parse(await fs.readFile(join(dir, 'meta.json'), 'utf8')); } catch { /* meta.json необязателен */ }
    const sha256 = typeof meta.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(meta.sha256) ? meta.sha256.toLowerCase() : await this.hash(file);
    const at = typeof meta.uploadedAt === 'string' && !Number.isNaN(Date.parse(meta.uploadedAt)) ? new Date(meta.uploadedAt) : stat.mtime;
    return { version, size: stat.size, sha256, uploadedAt: at.toISOString() };
  }

  async open(): Promise<{ stream: ReadStream; size: number }> {
    const { file } = await this.latest();
    return { stream: createReadStream(file), size: (await fs.stat(file)).size };
  }

  private hash(file: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const h = createHash('sha256');
      createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
    });
  }
}
