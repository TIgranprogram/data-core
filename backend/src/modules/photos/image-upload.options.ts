import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';

/** Один лимит и один список mime на все загрузки картинок. */
export const IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
// SVG не принимаем (БЗ-6 ЭФ2): файлы отдаются с того же домена `/uploads/*`, SVG со скриптом = XSS.
export const IMAGE_UPLOAD_MIME = /^image\/(jpeg|png|webp|gif|avif)$/;
/** Расширение файла на диске — по типу, а не по имени от клиента (иначе `x.html` с типом image/png отдался бы как страница). */
export const IMAGE_UPLOAD_EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
export const uploadFileName = (mimetype: string) => `${randomUUID()}${IMAGE_UPLOAD_EXT[mimetype] ?? ''}`;

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
      // {uuid}.{ext по типу} — случайное имя: без коллизий и обхода путей; расширение не из имени клиента.
      cb(null, uploadFileName(file.mimetype));
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
      cb(new BadRequestException(`Unsupported mimetype: ${file.mimetype}`), false); // 400 + русский текст (error-messages-ru)
      return;
    }
    cb(null, true);
  },
};
