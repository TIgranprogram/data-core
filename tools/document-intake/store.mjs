import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const helper = (name) => fileURLToPath(new URL(name, import.meta.url));

export const uid = () => randomUUID();
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const MAX_BYTES = 20 * 1024 * 1024;
export const FOLDERS = { inbox: 'Inbox', processing: 'Processing', ready: 'Ready', question: 'Question' };
export const RUSSIAN_FOLDERS = { inbox: 'Входящие', processing: 'В разборе', ready: 'Проверенные', question: 'Сомнительные' };

export class IntakeError extends Error {
  constructor(code, message, action) {
    super(message);
    this.code = code;
    this.action = action;
  }
}

export async function exists(file) {
  try { return await fs.lstat(file); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

async function syncDirectory(dir) {
  if (process.platform === 'win32') return;
  const handle = await fs.open(dir, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function jsonAtomic(file, item) {
  const dir = path.dirname(file);
  const temp = path.join(dir, `.${uid()}.tmp`);
  const handle = await fs.open(temp, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(item), 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    await fs.rename(temp, file);
    await syncDirectory(dir);
  } finally { await fs.rm(temp, { force: true }); }
}

export async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new IntakeError('JOURNAL', 'Журнал разбора не читается.', 'Сохраните папку целиком и передайте её ответственному за приложение.');
  }
}

function rootChain(root) {
  const ancestors = [];
  for (let dir = root; ; dir = path.dirname(dir)) {
    ancestors.unshift(dir);
    if (dir === path.dirname(dir)) return ancestors;
  }
}

export async function openRoot(root, { create = true, localized = false } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new IntakeError('FOLDER', 'Выберите полную папку разбора документов.');
  }
  const resolved = path.resolve(root);
  if (process.platform === 'win32' && resolved.startsWith('\\\\')) {
    throw new IntakeError('FOLDER', 'Выберите папку на локальном диске этого компьютера.');
  }
  async function directory(dir, dev) {
    let stats = await exists(dir);
    if (!stats && !create) return null;
    if (!stats) {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      stats = await fs.lstat(dir);
    }
    if (!stats.isDirectory() || stats.isSymbolicLink() || (dev !== undefined && stats.dev !== dev)) {
      throw new IntakeError('FOLDER', 'Папки разбора должны находиться на одном диске и не быть ссылками.');
    }
    return stats;
  }
  let rootStat;
  for (const dir of rootChain(resolved)) {
    rootStat = await directory(dir);
    if (!rootStat) break;
  }
  const state = path.join(resolved, '.intake');
  const marker = path.join(state, 'folders-ru');
  const stateStat = rootStat && await directory(state, rootStat.dev);
  const layout = stateStat && await exists(marker);
  if (layout && !layout.isFile()) throw new IntakeError('FOLDER', 'Служебный файл папки разбора повреждён.');
  let russian = !!layout;
  if (create && localized && !russian) {
    const previous = await Promise.all(Object.values(FOLDERS).map(name => exists(path.join(resolved, name))));
    if (!previous.some(Boolean)) {
      await fs.writeFile(marker, '', { flag: 'wx', mode: 0o600 });
      russian = true;
    }
  }
  const folders = Object.fromEntries(Object.entries(russian ? RUSSIAN_FOLDERS : FOLDERS).map(([key, name]) => [key, path.join(resolved, name)]));
  const arrivals = path.join(state, 'arrivals');
  const documents = path.join(state, 'documents');
  if (rootStat) for (const dir of [...Object.values(folders), arrivals, documents]) await directory(dir, rootStat.dev);
  return { root: rootStat ? await fs.realpath(resolved) : resolved, folders, arrivals, documents, rootStat, readOnly: !create };
}

// Сокет удерживает ОС. При аварийном выходе блокировка освобождается без удаления чужого lock-файла.
function lockAddress(root) {
  const hash = sha256(process.platform === 'win32' ? root.toLowerCase() : root);
  if (process.platform === 'win32') return `\\\\.\\pipe\\datacore-c169-${hash}`;
  if (process.platform === 'linux') return `\0datacore-c169-${hash}`;
  return { host: '127.0.0.1', port: 49152 + (parseInt(hash.slice(0, 4), 16) % 16384) };
}

export async function lock(root) {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(lockAddress(root), resolve);
  }).catch((e) => {
    if (e.code === 'EADDRINUSE') throw new IntakeError('BUSY', 'Эта папка уже разбирается.');
    throw new IntakeError('LOCK', 'Не удалось получить блокировку папки разбора.');
  });
  return () => new Promise((resolve) => server.close(resolve));
}

export async function isRunning(root) {
  return new Promise((resolve) => {
    const socket = net.connect(lockAddress(root));
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

export function arrivalFile(store, id) {
  return path.join(store.arrivals, `${id}.json`);
}

export function documentFile(store, hash) {
  return path.join(store.documents, `${hash}.json`);
}

export async function saveArrival(store, entry) {
  entry.updatedAt = new Date().toISOString();
  await jsonAtomic(arrivalFile(store, entry.arrivalId), entry);
}

async function listFolder(store, directory, options) {
  try { return await fs.readdir(directory, options); }
  catch (error) { if (store.readOnly && error.code === 'ENOENT') return []; throw error; }
}

export async function arrivalsOf(store) {
  const names = (await listFolder(store, store.arrivals)).filter((name) => /^[\da-f-]{36}\.json$/.test(name));
  const rows = await Promise.all(names.map(async (name) => {
    const row = await readJson(path.join(store.arrivals, name));
    if (row && (name !== `${row.arrivalId}.json` || !safeName(row.name) || !Object.hasOwn(FOLDERS, row.state)
      || row.state === 'inbox' || !['ready', 'question', undefined].includes(row.pending?.state) || typeof row.createdAt !== 'string')) {
      throw new IntakeError('JOURNAL', 'Запись журнала поступлений повреждена.', 'Сохраните папку целиком для сверки.');
    }
    return row;
  }));
  return rows.filter(Boolean).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const safeName = (name) => typeof name === 'string' && name.length > 0 && name.length <= 255
  && name !== '.' && name !== '..' && !/[\\/:\x00-\x1f\x7f]/u.test(name);

export async function inboxFiles(store) {
  return (await listFolder(store, store.folders.inbox, { withFileTypes: true }))
    .filter((item) => item.isFile() && safeName(item.name) && !item.name.startsWith('.') && !item.name.startsWith('~$') && !/\.(?:part|partial|tmp|crdownload|download|filepart)$/i.test(item.name))
    .map((item) => item.name).sort();
}

function withinArrival(store, state, entry) {
  return path.join(store.folders[state], entry.arrivalId);
}

export const originalPath = (store, entry) => path.join(withinArrival(store, 'processing', entry), entry.name);

function unchanged(a, b) {
  return !!(a?.isFile() && b?.isFile() && a.dev === b.dev && a.ino === b.ino
    && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs);
}

async function captureClosed(input, target) {
  const windows = process.platform === 'win32';
  if (!windows && process.platform !== 'linux') {
    throw new IntakeError('FOLDER', 'Захват закрытых файлов поддерживается в Windows и Linux.');
  }
  const program = windows ? 'powershell.exe' : 'python3';
  const args = windows
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper('./claim.ps1'), input, target]
    : [helper('./claim-linux.py'), input, target];
  try {
    const { stdout } = await exec(program, args, { timeout: 60_000, windowsHide: true, maxBuffer: 4096 });
    const hash = stdout.trim();
    if (/^[\da-f]{64}$/.test(hash)) return hash;
  } catch (e) {
    if (e.code === 3) return null;
    if (e.code === 4) {
      throw new IntakeError('FOLDER', 'Файловая система не поддерживает проверку закрытия файла.', 'Выберите папку на локальном диске и возобновите разбор.');
    }
  }
  throw new IntakeError('ORIGINAL', 'Не удалось безопасно захватить исходный файл.', 'Проверьте папку и возобновите разбор.');
}

export async function claim(store, name, stableMs = 2200, metadata) {
  if (!safeName(name)) return null;
  await checkWorkflowFolders(store, ['inbox', 'processing']);
  const input = path.join(store.folders.inbox, name);
  const stat = await exists(input);
  if (!stat?.isFile() || stat.nlink !== 1 || (stableMs > 0 && Date.now() - Math.max(stat.mtimeMs, stat.ctimeMs) < stableMs)) return null;
  const entry = { arrivalId: uid(), name, state: 'processing', phase: 'claiming', createdAt: new Date().toISOString() };
  if (metadata) {
    if (metadata.workflow !== 'c171' || typeof metadata.batchId !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.test(metadata.batchId)) {
      throw new IntakeError('JOURNAL', 'Не подтверждён режим захвата документа.');
    }
    entry.workflow = metadata.workflow;
    entry.batchId = metadata.batchId;
    if (metadata.owner && metadata.target) {
      entry.reviewOwner = metadata.owner;
      entry.reviewTarget = metadata.target;
    }
  }
  await saveArrival(store, entry);
  const target = withinArrival(store, 'processing', entry);
  await checkWorkflowFolders(store, ['inbox', 'processing']);
  await fs.mkdir(target, { mode: 0o700 });
  const unmodified = unchanged(stat, await exists(input));
  await checkWorkflowFolders(store, ['inbox', 'processing']);
  await checkedDirectory(target, store.rootStat.dev);
  if (!unmodified) {
    await fs.rmdir(target);
    await fs.rm(arrivalFile(store, entry.arrivalId));
    return null;
  }
  const hash = await captureClosed(input, originalPath(store, entry));
  if (!hash) {
    await fs.rmdir(target);
    await fs.rm(arrivalFile(store, entry.arrivalId));
    return null;
  }
  await syncDirectory(target);
  await syncDirectory(store.folders.inbox);
  await syncDirectory(store.folders.processing);
  entry.phase = 'claimed';
  entry.hash = hash;
  await saveArrival(store, entry);
  return entry;
}

async function checkedDirectory(dir, dev) {
  const stats = await exists(dir);
  if (!stats?.isDirectory() || stats.isSymbolicLink() || (dev !== undefined && stats.dev !== dev)) {
    throw new IntakeError('ORIGINAL', 'Папка разбора отсутствует, стала ссылкой или сменила диск.', 'Восстановите папки разбора и возобновите работу.');
  }
  return stats;
}

async function checkWorkflowFolders(store, states) {
  for (const dir of rootChain(store.root)) await checkedDirectory(dir);
  const root = await checkedDirectory(store.root, store.rootStat.dev);
  if (root.ino !== store.rootStat.ino) {
    throw new IntakeError('ORIGINAL', 'Корневая папка разбора была заменена.', 'Верните исходную папку разбора и возобновите работу.');
  }
  for (const state of states) await checkedDirectory(store.folders[state], root.dev);
}

async function checkArrivalFolder(store, entry, state) {
  await checkWorkflowFolders(store, [state]);
  const folder = withinArrival(store, state, entry);
  await checkedDirectory(folder, store.rootStat.dev);
  return folder;
}

async function moveArrival(store, entry, from, to) {
  const source = withinArrival(store, from, entry);
  const target = withinArrival(store, to, entry);
  await checkWorkflowFolders(store, [from, to]);
  await checkedDirectory(source, store.rootStat.dev);
  if (await exists(target)) {
    throw new IntakeError('JOURNAL', 'Папка назначения этого поступления уже существует.', 'Сохраните обе папки для сверки.');
  }
  await fs.rename(source, target);
  await syncDirectory(store.folders[from]);
  await syncDirectory(store.folders[to]);
}

export async function readOriginal(store, entry, maxBytes = MAX_BYTES, state = entry.state) {
  const folder = await checkArrivalFolder(store, entry, state);
  const file = path.join(folder, entry.name);
  const snapshot = await exists(file);
  if (!snapshot?.isFile() || snapshot.nlink !== 1) throw new IntakeError('ORIGINAL', 'Исходный файл отсутствует или стал ссылкой.', 'Найдите оригинал по имени в отчёте.');
  if (snapshot.size > maxBytes) throw new IntakeError('QUESTION', 'Документ превышает 20 МБ.', 'Сохраните текстовый PDF меньшего размера и положите его во «Входящие».');
  const handle = await fs.open(file, 'r');
  let bytes;
  try {
    if (!unchanged(snapshot, await handle.stat())) throw new IntakeError('ORIGINAL', 'Исходный файл изменился во время открытия.');
    bytes = await handle.readFile();
  } finally { await handle.close(); }
  if (!unchanged(snapshot, await exists(file)) || bytes.length !== snapshot.size) {
    throw new IntakeError('ORIGINAL', 'Исходный файл изменился во время чтения.', 'Закройте программу, которая сохраняет документ, затем возобновите разбор.');
  }
  return bytes;
}

export async function finishArrival(store, entry, final) {
  entry.pending = final;
  await saveArrival(store, entry);
  return reconcileArrival(store, entry);
}

export async function startRetry(store, entry, { target, owner }) {
  entry.history ??= [];
  entry.history.push({ state: entry.state, outcome: entry.outcome, message: entry.message, action: entry.action, at: entry.updatedAt });
  entry.retryIntent = { target, owner };
  entry.phase = 'retrying';
  entry.state = 'processing';
  delete entry.outcome;
  delete entry.message;
  delete entry.action;
  await saveArrival(store, entry);
}

export async function reconcileRetry(store, entry) {
  const source = withinArrival(store, 'question', entry);
  const target = withinArrival(store, 'processing', entry);
  await checkWorkflowFolders(store, ['question', 'processing']);
  if (await exists(target)) {
    await checkArrivalFolder(store, entry, 'processing');
    if (await exists(source) || !(await exists(originalPath(store, entry)))?.isFile()) {
      throw new IntakeError('JOURNAL', 'Повторный разбор нашёл две папки одного поступления.', 'Сохраните оба файла для ручной сверки.');
    }
  } else {
    await moveArrival(store, entry, 'question', 'processing');
  }
  entry.phase = 'claimed';
  await saveArrival(store, entry);
}

export async function reconcileArrival(store, entry) {
  const from = entry.state;
  const source = withinArrival(store, from, entry);
  if (entry.pending) {
    const destination = entry.pending.state;
    const target = withinArrival(store, destination, entry);
    const original = path.join(target, entry.name);
    await checkWorkflowFolders(store, [from, destination]);
    if (await exists(target)) {
      await checkArrivalFolder(store, entry, destination);
      if (await exists(source) || !(await exists(original))?.isFile()) {
        throw new IntakeError('JOURNAL', 'Две папки одного поступления требуют сверки.', 'Откройте папки «Разбираются» и папку результата. Сохраните оба файла.');
      }
    } else {
      await checkArrivalFolder(store, entry, from);
      if (!(await exists(path.join(source, entry.name)))?.isFile()) {
        throw new IntakeError('ORIGINAL', 'Не найден оригинал для перемещения.', 'Верните файл в исходную папку поступления.');
      }
      await moveArrival(store, entry, from, destination);
    }
    if (destination === 'ready') {
      try {
        const bytes = await readOriginal(store, entry, MAX_BYTES, 'ready');
        if (sha256(bytes) !== entry.hash) {
          throw new IntakeError('ORIGINAL', 'После перемещения содержимое оригинала не совпало.', 'Верните неизменённый оригинал и возобновите разбор.');
        }
      } catch (error) {
        // Возврат допустим только через проверенные папки и при свободном месте в очереди.
        await moveArrival(store, entry, 'ready', from);
        if (error instanceof IntakeError && error.code === 'QUESTION') {
          throw new IntakeError('ORIGINAL', 'Размер оригинала изменился после перемещения.', 'Верните неизменённый оригинал и возобновите разбор.');
        }
        throw error;
      }
    }
    Object.assign(entry, entry.pending);
    delete entry.pending;
    delete entry.phase;
    delete entry.retryIntent;
    await saveArrival(store, entry);
  } else if (entry.phase === 'claiming') {
    if (!(await exists(originalPath(store, entry)))?.isFile()) {
      if (await exists(source)) await fs.rmdir(source);
      await fs.rm(arrivalFile(store, entry.arrivalId), { force: true });
      return null;
    }
    entry.phase = 'claimed';
    await saveArrival(store, entry);
  }
  return entry;
}
