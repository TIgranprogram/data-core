import { randomUUID } from 'crypto';
import * as path from 'path';

/** Каталог вложений внутри папки загрузок. Наружу (`/uploads/*`) не раздаётся — только по тикету. */
export const ATTACHMENTS_DIR = 'attachments';

export const isObjectIdStr = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v);

/** Относительный путь файла: `attachments/<изделие>/<вид>/<uuid>.<расширение>`. Имя от клиента на диск не идёт. */
export function storedRel(productId: string, typeId: string, ext: string, id: string = randomUUID()): string {
  if (!isObjectIdStr(productId) || !isObjectIdStr(typeId)) throw new Error('bad id');
  if (!/^[a-z0-9]{1,8}$/.test(ext)) throw new Error('bad ext');
  return [ATTACHMENTS_DIR, productId.toLowerCase(), typeId.toLowerCase(), `${id}.${ext}`].join('/');
}

/** Абсолютный путь внутри `root`; выход за пределы (`..`, абсолютный путь) — ошибка. */
export function resolveInside(root: string, rel: string): string {
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('path escapes root');
  return abs;
}

/** Адрес запроса ведёт в папку вложений (с учётом `%61`, `..`, `//`, регистра, обратных слэшей). */
export function isAttachmentsUrl(url: string | undefined): boolean {
  let p = String(url ?? '').split('?')[0].split('#')[0];
  for (let i = 0; i < 3; i++) {
    try { const d = decodeURIComponent(p); if (d === p) break; p = d; } catch { return true; } // битая кодировка — не пускаем
  }
  p = path.posix.normalize(p.replace(/\\/g, '/')).toLowerCase();
  return /^\/+uploads\/+attachments(\/|$)/.test(p);
}

/** Имя для скачивания: без путей и управляющих символов, без точки в начале, не длиннее 200 знаков. */
export function safeDownloadName(name: string, fallback = 'file'): string {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 200);
  return cleaned || fallback;
}

/** Заголовок `Content-Disposition` для скачивания (кириллица — через filename*). */
export function contentDisposition(name: string): string {
  const safe = safeDownloadName(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_') || 'file';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}

/** `Range: bytes=a-b` → отрезок; `null` — заголовка нет (отдаём целиком); `'bad'` — 416. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'bad' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'bad';
  let start: number;
  let end: number;
  if (m[1] === '') { const n = Number(m[2]); if (n <= 0) return 'bad'; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (!(start <= end) || start >= size) return 'bad';
  return { start, end };
}
