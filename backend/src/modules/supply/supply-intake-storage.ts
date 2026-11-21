import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { basename, dirname, join } from 'path';
import { safeUploadPath } from '../../common/uploads/safe-path';
import { inspectIntakePdf, syncIntakeDirectory } from '../photos/photo-intake.storage';

export const reviewedUrl = (fileId: string) => '/uploads/reviewed-invoices/' + fileId + '.pdf';
const reviewedPath = (fileId: string) => {
  if (!/^[a-f0-9]{24}$/.test(fileId)) throw new ConflictException('Некорректный ключ оригинала');
  return safeUploadPath(reviewedUrl(fileId))!;
};

/** Mongo хранит intent до записи байтов. Повтор завершает тот же файл, включая обрыв до rename. */
export async function stageReviewedPdf(fileId: string, bytes: Buffer, sha256: string) {
  const target = reviewedPath(fileId);
  const dir = dirname(target);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const prior = await inspectIntakePdf(target, bytes.length);
  if (prior && (!prior.pdf || prior.sha256 !== sha256)) throw new ConflictException('Сохранённый оригинал повреждён');
  if (!prior) {
    const tmp = target + '.' + randomUUID() + '.tmp';
    try {
      const fd = await fs.open(tmp, 'wx', 0o600);
      try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
      const check = await inspectIntakePdf(tmp, bytes.length);
      if (!check?.pdf || check.sha256 !== sha256) throw new ConflictException('Карантин не подтвердил оригинал');
      await fs.rename(tmp, target);
    } finally { await fs.rm(tmp, { force: true }); }
  }
  await syncIntakeDirectory(target);
  await clearReviewFiles(fileId, false);
}

/** Удаляем только остатки данного серверного intent. Финальный файл удаляется после CAS отказа. */
export async function clearReviewFiles(fileId: string, includeOriginal: boolean) {
  const target = reviewedPath(fileId);
  const dir = dirname(target);
  const names = await fs.readdir(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return [];
    throw err;
  });
  const prefix = basename(target) + '.';
  for (const name of names) {
    if (name.startsWith(prefix) && name.endsWith('.tmp')) await fs.rm(join(dir, name), { force: true });
  }
  if (includeOriginal) await fs.rm(target, { force: true });
}
