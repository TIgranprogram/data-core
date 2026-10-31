import { promises as fs } from 'fs';
import path from 'path';
import { dirSize } from './disk-fs';

/** Штамп копии из backup.sh: 2026-10-25_031500. Только он попадает в путь (защита от выхода за папку). */
export const STAMP_RE = /^\d{4}-\d{2}-\d{2}_\d{6}$/;
export type BackupPart = 'mongo' | 'uploads' | 'all';

export const isStamp = (s: unknown): s is string => typeof s === 'string' && STAMP_RE.test(s);
export const parsePart = (p: unknown): BackupPart | null => (p === undefined || p === 'all' ? 'all' : p === 'mongo' || p === 'uploads' ? p : null);

export const backupsRoot = () => path.join(process.env.HOST_DATA_DIR || '/host-data', 'backups');

/** «2026-10-25_031500» → «2026-10-25T03:15:00» (время сервера, как пишет cron). */
export const stampDate = (stamp: string) => `${stamp.slice(0, 10)}T${stamp.slice(11, 13)}:${stamp.slice(13, 15)}:${stamp.slice(15, 17)}`;

/** Второй сервер (SRV-ERP/backup-erp.sh) пишет один архив srv-erp-20261031-1901.tgz — штамп 2026-10-31_190100. */
const TGZ_RE = /^srv-erp-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.tgz$/;
const tgzStamp = (n: string) => { const m = TGZ_RE.exec(n); return m ? `${m[1]}-${m[2]}-${m[3]}_${m[4]}${m[5]}00` : null; };
/** Все копии в папке: штамп → вид (папки mongo-/uploads- или один архив). */
export function backupStamps(names: string[]) {
  const out = new Map<string, { kind: 'dirs' } | { kind: 'tgz'; file: string }>();
  for (const n of names) {
    if (n.startsWith('mongo-') && isStamp(n.slice(6))) out.set(n.slice(6), { kind: 'dirs' });
    const t = tgzStamp(n);
    if (t && !out.has(t)) out.set(t, { kind: 'tgz', file: n });
  }
  return out;
}
/** Архив второго сервера для штампа или null. */
export async function backupTgz(root: string, stamp: string) {
  if (!isStamp(stamp)) return null;
  const hit = backupStamps(await fs.readdir(root).catch(() => [] as string[])).get(stamp);
  return hit && hit.kind === 'tgz' ? path.join(root, hit.file) : null;
}

const isRealDir = (p: string) => fs.lstat(p).then((s) => s.isDirectory(), () => false);

type BackupRow = { stamp: string; date: string; mongoBytes: number; uploadsBytes: number | null; totalBytes: number; single?: boolean };
/** Размеры готовых копий не меняются — считаем один раз (обход папок грузит единственное ядро VM). Ключ — корень + штамп. */
const sizeCache = new Map<string, BackupRow>();

/** Список копий по штампам, новые сверху. null — папка копий не подключена. */
export async function listBackups(root: string) {
  let names: string[];
  try { names = await fs.readdir(root); } catch { return null; }
  const all = backupStamps(names);
  const stamps = [...all.keys()].sort().reverse();
  for (const k of sizeCache.keys()) if (k.startsWith(root + '|') && !stamps.includes(k.slice(root.length + 1))) sizeCache.delete(k);
  return Promise.all(stamps.map(async (stamp, i) => {
    const key = `${root}|${stamp}`;
    const hit = sizeCache.get(key);
    if (hit) return hit;
    const one = all.get(stamp)!;
    if (one.kind === 'tgz') { // один архив: база и фото вместе
      const bytes = (await fs.stat(path.join(root, one.file))).size;
      const row: BackupRow = { stamp, date: stampDate(stamp), mongoBytes: bytes, uploadsBytes: null, totalBytes: bytes, single: true };
      if (i > 0) sizeCache.set(key, row);
      return row;
    }
    const mongoBytes = (await dirSize(path.join(root, `mongo-${stamp}`))).bytes;
    const upDir = path.join(root, `uploads-${stamp}`);
    const uploadsBytes = (await isRealDir(upDir)) ? (await dirSize(upDir)).bytes : null;
    const row = { stamp, date: stampDate(stamp), mongoBytes, uploadsBytes, totalBytes: mongoBytes + (uploadsBytes ?? 0) };
    if (i > 0) sizeCache.set(key, row); // самая новая может ещё дописываться — её не кэшируем
    return row;
  }));
}

/** Дата последней копии без подсчёта размеров (А3, сторож в /health). undefined — папка не подключена, null — копий нет. */
export async function latestBackupDate(root: string): Promise<string | null | undefined> {
  let names: string[];
  try { names = await fs.readdir(root); } catch { return undefined; }
  const last = [...backupStamps(names).keys()].sort().pop();
  return last ? stampDate(last) : null;
}

/** Папки для архива: [путь на диске, имя внутри архива]. Только реальные каталоги (не симлинки). */
export async function backupDirs(root: string, stamp: string, part: BackupPart) {
  const out: Array<[string, string]> = [];
  for (const k of part === 'all' ? ['mongo', 'uploads'] : [part]) {
    const dir = path.join(root, `${k}-${stamp}`);
    if (await isRealDir(dir)) out.push([dir, `${k}-${stamp}`]);
  }
  return out;
}

export const archiveName = (stamp: string, part: BackupPart) => `datacore-backup-${stamp}${part === 'all' ? '' : '-' + part}.zip`;
