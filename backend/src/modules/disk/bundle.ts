import { promises as fs } from 'fs';
import path from 'path';

/** Имя пакета из bundle.sh. Только оно попадает в путь (защита от выхода за папку). */
export const BUNDLE_RE = /^datacore-bundle-[0-9A-Za-z_.-]+\.tar\.gz$/;
export const isBundleName = (s: unknown): s is string => typeof s === 'string' && BUNDLE_RE.test(s) && !s.includes('..');

/** Сборка, которая «идёт» дольше этого, считается брошенной (хост упал) — иначе кнопка зависнет навсегда. */
export const STALE_RUNNING_MS = 6 * 3600 * 1000;

export const bundlesRoot = () => process.env.HOST_BUNDLES_DIR || '/host-bundles';
export const requestsRoot = () => process.env.HOST_REQUESTS_DIR || '/host-requests';

export type BundleState = 'idle' | 'queued' | 'running' | 'done' | 'failed';
export interface BundleStatus { state: BundleState; startedAt?: string; finishedAt?: string; file?: string; bytes?: number; error?: string }

const exists = (p: string) => fs.lstat(p).then(() => true, () => false);

/** status.json от bundle-watch.sh + файл-запрос → единое состояние. Битый/чужой файл — как «нет статуса». */
export async function readBundleStatus(reqDir: string, now = Date.now()): Promise<BundleStatus> {
  let raw: Partial<BundleStatus> = {};
  try {
    const j = JSON.parse(await fs.readFile(path.join(reqDir, 'status.json'), 'utf8'));
    if (j && typeof j === 'object') raw = j;
  } catch { /* нет статуса */ }
  const pick = (): BundleStatus => {
    const st: BundleStatus = { state: 'idle' };
    if (raw.state === 'running' || raw.state === 'done' || raw.state === 'failed') st.state = raw.state;
    if (typeof raw.startedAt === 'string') st.startedAt = raw.startedAt;
    if (typeof raw.finishedAt === 'string') st.finishedAt = raw.finishedAt;
    if (typeof raw.file === 'string' && isBundleName(raw.file)) st.file = raw.file;
    if (typeof raw.bytes === 'number') st.bytes = raw.bytes;
    if (typeof raw.error === 'string') st.error = raw.error.slice(0, 2000);
    return st;
  };
  const st = pick();
  if (st.state === 'running' && st.startedAt && now - Date.parse(st.startedAt) > STALE_RUNNING_MS) {
    return { ...st, state: 'failed', error: 'Сборка не завершилась за 6 часов — проверьте хост (bundle-watch.sh, лог bundles/bundle.log).' };
  }
  if (st.state !== 'running' && (await exists(path.join(reqDir, 'request')))) return { state: 'queued' };
  return st;
}

/** Список пакетов, новые сверху. null — папка пакетов не подключена. */
export async function listBundles(root: string) {
  let names: string[];
  try { names = await fs.readdir(root); } catch { return null; }
  const items: Array<{ name: string; date: string; bytes: number }> = [];
  for (const name of names.filter(isBundleName)) {
    const st = await fs.lstat(path.join(root, name)).catch(() => null);
    if (st && st.isFile()) items.push({ name, date: st.mtime.toISOString(), bytes: st.size });
  }
  return items.sort((a, b) => b.date.localeCompare(a.date));
}

/** Обычный файл пакета (не симлинк, не каталог) или null. */
export async function bundleFile(root: string, name: string) {
  if (!isBundleName(name)) return null;
  const file = path.join(root, name);
  const st = await fs.lstat(file).catch(() => null);
  return st && st.isFile() ? { file, bytes: st.size } : null;
}

export type RequestResult = 'ok' | 'busy';

/** Кладёт файл-запрос для bundle-watch.sh. busy — запрос уже есть или сборка идёт. */
export async function createBundleRequest(reqDir: string): Promise<RequestResult> {
  const st = await readBundleStatus(reqDir);
  if (st.state === 'running' || st.state === 'queued') return 'busy';
  const file = path.join(reqDir, 'request');
  try {
    await fs.writeFile(file, new Date().toISOString() + '\n', { flag: 'wx', mode: 0o666 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return 'busy';
    throw e;
  }
  await fs.chmod(file, 0o666).catch(() => undefined); // umask контейнера мог урезать — хост (другой uid) должен суметь удалить
  return 'ok';
}
