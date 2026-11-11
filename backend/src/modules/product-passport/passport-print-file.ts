import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Types } from 'mongoose';
import { safeUploadPath, uploadsRoot } from '../../common/uploads/safe-path';
import { uploadSubdir } from '../../common/uploads/upload-folder';
import { decodeMulterOriginalName, PDF_UPLOAD_MAX_BYTES } from '../photos/image-upload.options';
import type { Doc } from './passport-consts';

/** Свой PDF номера. В базе — путь; в ответе API путь не отдаём. */
export type StoredPrintFile = { path: string; originalName: string; uploadedAt: Date; uploadedBy?: Types.ObjectId };

export type PrintPresent = { printSource: 'file' | 'app'; printFile: { name: string | null; hasFile: boolean } };

const safeName = (name: string) => {
  const base = name.replace(/[\r\n\\/:*?"<>|]/g, '_').trim().slice(0, 120) || 'passport.pdf';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
};

/** Список и карточка: откуда печатать и есть ли свой файл. Путь на диск наружу не уходит. */
export function presentPrint(doc: Doc): PrintPresent {
  const f = doc.printFile as { path?: string; originalName?: string } | undefined;
  const has = !!f?.path;
  return { printSource: has ? 'file' : 'app', printFile: { name: has ? safeName(String(f?.originalName || 'passport.pdf')) : null, hasFile: has } };
}

/** Прикреплённый PDF. Нет файла — null, PDF собирает сайт. Путь есть, файла нет — 400. */
export async function readPrintFile(doc: Doc): Promise<{ buf: Buffer; filename: string } | null> {
  const f = doc.printFile as { path?: string; originalName?: string } | undefined;
  if (!f?.path) return null;
  const disk = safeUploadPath(f.path);
  if (!disk) throw new BadRequestException('Файл печати повреждён — прикрепите PDF снова');
  try {
    return { buf: await fs.readFile(disk), filename: safeName(String(f.originalName || 'passport.pdf')) };
  } catch {
    throw new BadRequestException('Файл печати не найден — прикрепите PDF снова');
  }
}

/** Только PDF (тип и подпись %PDF), не больше 20 МБ. */
export function assertPdf(file: { mimetype?: string; size?: number; buffer?: Buffer; originalname?: string } | undefined): Buffer {
  if (!file?.buffer?.length) throw new BadRequestException('Прикрепите PDF');
  if ((file.size ?? file.buffer.length) > PDF_UPLOAD_MAX_BYTES) throw new BadRequestException('PDF больше 20 МБ');
  if (file.mimetype && file.mimetype !== 'application/pdf') throw new BadRequestException('Нужен файл PDF');
  if (!file.buffer.subarray(0, 5).toString('latin1').startsWith('%PDF')) throw new BadRequestException('Нужен файл PDF');
  return file.buffer;
}

/** Кладёт PDF в uploads/passport/ГГГГ-ММ/<uuid>.pdf. Имя клиента на диск не попадает. */
export async function storePrintPdf(buf: Buffer, originalName: string | undefined, userId?: string): Promise<StoredPrintFile> {
  const sub = uploadSubdir('passport');
  const dir = join(uploadsRoot(), ...sub.split('/'));
  await fs.mkdir(dir, { recursive: true });
  const file = `${randomUUID()}.pdf`;
  await fs.writeFile(join(dir, file), buf);
  const uploadedBy = userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
  return { path: `/uploads/${sub}/${file}`, originalName: safeName(decodeMulterOriginalName(originalName) || 'passport.pdf'), uploadedAt: new Date(), ...(uploadedBy ? { uploadedBy } : {}) };
}

/** Стереть прежний файл, если он лежит в папке загрузок. Чужой путь не трогаем. */
export async function unlinkPrint(path: unknown): Promise<void> {
  const disk = safeUploadPath(path);
  if (!disk) return;
  await fs.unlink(disk).catch(() => undefined);
}
