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

const isRealDir = (p: string) => fs.lstat(p).then((s) => s.isDirectory(), () => false);

/** Список копий по штампам, новые сверху. null — папка копий не подключена. */
export async function listBackups(root: string) {
  let names: string[];
  try { names = await fs.readdir(root); } catch { return null; }
  const stamps = names.filter((n) => n.startsWith('mongo-') && isStamp(n.slice(6))).map((n) => n.slice(6)).sort().reverse();
  return Promise.all(stamps.map(async (stamp) => {
    const mongoBytes = (await dirSize(path.join(root, `mongo-${stamp}`))).bytes;
    const upDir = path.join(root, `uploads-${stamp}`);
    const uploadsBytes = (await isRealDir(upDir)) ? (await dirSize(upDir)).bytes : null;
    return { stamp, date: stampDate(stamp), mongoBytes, uploadsBytes, totalBytes: mongoBytes + (uploadsBytes ?? 0) };
  }));
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
