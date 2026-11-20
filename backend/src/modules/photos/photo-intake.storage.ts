import { BadRequestException, ConflictException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { createHash, randomUUID } from 'crypto';
import { constants, promises as fs } from 'fs';
import { dirname, join } from 'path';
import { diskStorage } from 'multer';
import { uploadsRoot } from '../../common/uploads/safe-path';
import { decodeMulterOriginalName, PDF_MIME, PDF_UPLOAD_MAX_BYTES } from './image-upload.options';

const INTAKE_DIRECTORY = 'document-intake';
export const PHOTO_INTAKE_URL_PREFIX = `/uploads/${INTAKE_DIRECTORY}/`;

export interface IntakeUploadFile {
  path: string;
  originalname: string;
  size: number;
}

export const intakeUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      const dir = join(uploadsRoot(), INTAKE_DIRECTORY);
      void fs.mkdir(dir, { recursive: true }).then(() => cb(null, dir), err => cb(err, dir));
    },
    // Незаконченный файл скрыт от раздачи статики и лежит на том же томе, что оригинал.
    filename: (_req, _file, cb) => cb(null, `.incoming-${randomUUID()}.tmp`),
  }),
  // Multer прерывает поток при достижении лимита. Оставляем разрешёнными ровно 20 МиБ.
  limits: { fileSize: PDF_UPLOAD_MAX_BYTES + 1, files: 1, fields: 0 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== PDF_MIME) {
      cb(new BadRequestException('Для загрузки источника нужен PDF'), false);
      return;
    }
    file.originalname = decodeMulterOriginalName(file.originalname);
    cb(null, true);
  },
};

export function fileErrorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

/** Читаем один дескриптор. Поток ограничен проверенным размером, ссылки и спецфайлы отклоняются. */
export async function inspectIntakePdf(path: string, size: number): Promise<{ sha256: string; pdf: boolean } | null> {
  try {
    const entry = await fs.lstat(path);
    if (!entry.isFile() || entry.size !== size || size > PDF_UPLOAD_MAX_BYTES || size < 5) {
      throw new ConflictException('Оригинал источника повреждён или подменён');
    }
    const file = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const hash = createHash('sha256');
      const header = Buffer.alloc(5);
      let read = 0;
      for await (const chunk of file.createReadStream({ autoClose: false, end: size })) {
        const bytes = chunk as Buffer;
        if (read < header.length) bytes.copy(header, read, 0, header.length - read);
        read += bytes.length;
        hash.update(bytes);
      }
      if (read !== size) throw new ConflictException('Размер оригинала источника изменился');
      return { sha256: hash.digest('hex'), pdf: header.toString('ascii') === '%PDF-' };
    } finally {
      await file.close();
    }
  } catch (error) {
    if (fileErrorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

export async function publishIntakePdf(staged: string, target: string): Promise<void> {
  const file = await fs.open(staged, 'r+');
  try {
    await file.sync();
  } finally {
    await file.close();
  }
  // link атомарен и не заменяет уже опубликованный файл. После EEXIST сверяем байты.
  try {
    await fs.link(staged, target);
  } catch (error) {
    if (fileErrorCode(error) !== 'EEXIST') throw error;
  }
}

export async function syncIntakeDirectory(target: string): Promise<void> {
  // На Windows Node не поддерживает открытие каталога для fsync.
  if (process.platform !== 'win32') {
    for (const path of [dirname(target), dirname(dirname(target))]) {
      const dir = await fs.open(path, 'r');
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    }
  }
}
