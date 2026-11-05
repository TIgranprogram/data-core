import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { decodeMulterOriginalName, UPLOAD_DIR } from '../photos/image-upload.options';
import { attachmentMaxBytes, extOf, isAllowedExt, MSG_EXT } from './attachment-formats';
import { isObjectIdStr, resolveInside, storedRel } from './attachment-paths';

type Req = { params?: Record<string, string>; query?: Record<string, unknown> };

/**
 * Поток на диск (не в память): `uploads/attachments/<изделие>/<вид>/<uuid>.<ext>`.
 * Идентификаторы берёт и проверяет сервер (изделие — из адреса, вид — из `?typeId=`); имя от клиента на диск не попадает.
 * Лимит — `ATTACHMENT_MAX_BYTES` (по умолчанию 512 МБ). При обрыве или превышении multer сам стирает недописанный файл.
 */
export const attachmentUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination: (req, _file, cb) => {
      try {
        const r = req as unknown as Req;
        const rel = storedRel(String(r.params?.id), String(r.query?.typeId), 'bin');
        const dir = resolveInside(UPLOAD_DIR, rel.slice(0, rel.lastIndexOf('/')));
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch {
        cb(new BadRequestException('Не указано изделие или вид вложения.'), '');
      }
    },
    filename: (_req, file, cb) => cb(null, `${randomUUID()}.${extOf(file.originalname)}`),
  }),
  limits: { fileSize: attachmentMaxBytes(), files: 1 },
  fileFilter: (req, file, cb) => {
    file.originalname = decodeMulterOriginalName(file.originalname);
    const r = req as unknown as Req;
    if (!isObjectIdStr(r.params?.id) || !isObjectIdStr(r.query?.typeId)) return cb(new BadRequestException('Не указано изделие или вид вложения.'), false);
    if (!isAllowedExt(extOf(file.originalname))) return cb(new BadRequestException(MSG_EXT), false);
    cb(null, true);
  },
};
