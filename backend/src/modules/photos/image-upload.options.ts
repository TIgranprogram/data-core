import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';

/** Один лимит и один список mime на все загрузки картинок. */
export const IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_UPLOAD_MIME = /^image\/(jpeg|png|webp|gif|avif|svg\+xml)$/;

const CYRILLIC = /[\u0400-\u04FF]/;
const LATIN1_HIGH = /[\u0080-\u00FF]/;

/**
 * Multer treats Content-Disposition filenames as latin1. UTF-8 Cyrillic
 * then shows up as mojibake (`Ð¡Ð½Ð¸Ð¼Ð¾Ðº…`). Decode only when the name
 * still looks like latin1 high bytes and does not already contain Cyrillic —
 * already-correct UTF-8 must stay untouched.
 */
export function decodeMulterOriginalName(name: string | undefined): string {
  if (!name) return '';
  if (CYRILLIC.test(name) || !LATIN1_HIGH.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  if (!decoded || decoded.includes('\uFFFD')) return name;
  return decoded;
}

/**
 * TZ-ORG-ASSETS-301: конфиг вынесен из `photos.module.ts`, потому что теперь
 * картинки принимает не только `POST /photos/upload`, но и хранилище файлов
 * организации. Дублировать лимит/mime в двух модулях — способ разъехаться.
 */
export const imageUploadMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      // {uuid}.{ext} — random prefix avoids collisions and path traversal.
      const id = randomUUID();
      cb(null, `${id}${extname(file.originalname ?? '')}`);
    },
  }),
  limits: {
    fileSize: IMAGE_UPLOAD_MAX_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (file.originalname) {
      file.originalname = decodeMulterOriginalName(file.originalname);
    }
    // Только картинки — никаких .exe/.zip/etc.
    if (!IMAGE_UPLOAD_MIME.test(file.mimetype)) {
      cb(new Error(`Unsupported mimetype: ${file.mimetype}`), false);
      return;
    }
    cb(null, true);
  },
};
