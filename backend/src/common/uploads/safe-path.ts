import { isAbsolute, join, relative, resolve } from 'path';

/** Ссылка на загруженный файл: `/uploads/<имя>` (латиница, цифры, точка, дефис, подчёркивание, подпапки через «/»). */
export const SAFE_UPLOAD_URL_RE = /^\/uploads\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

/** Папка загрузок на диске (UPLOAD_DIR или ./uploads от рабочей папки процесса). */
export function uploadsRoot(): string {
  return resolve(process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads'));
}

/**
 * Путь на диске для ссылки из базы (`storageUrl`) — или null, если ссылка ведёт не в папку загрузок
 * (ARCH-PLAN М1): «..», %-кодирование, обратные слэши, чужие пути. Плохая ссылка — картинка пропускается, файл не удаляется.
 */
export function safeUploadPath(url: unknown, root = uploadsRoot()): string | null {
  const u = String(url ?? '');
  if (!SAFE_UPLOAD_URL_RE.test(u) || u.includes('..')) return null;
  const reviewed = /^\/uploads\/reviewed-invoices\/([a-f0-9]{24})\.pdf$/.exec(u);
  // Публичная ссылка читает приватный файл только после подтверждения транзакции.
  const p = reviewed ? resolve(root, '.reviewed-invoices', reviewed[1] + '.pdf') : resolve(root, u.slice('/uploads/'.length));
  const rel = relative(root, p);
  return !rel || rel.startsWith('..') || isAbsolute(rel) ? null : p;
}
