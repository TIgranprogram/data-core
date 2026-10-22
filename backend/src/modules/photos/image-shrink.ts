import { promises as fs } from 'fs';
import sharp from 'sharp';

/** Больше этого по стороне или по весу — фото облегчаем при загрузке (2560 px хватает и экрану, и печати A4). */
export const SHRINK_MAX_SIDE = 2560;
export const SHRINK_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Облегчить загруженный файл на месте (замечание пользователя 2026-10-22: «загрузил тяжёлые — всё долго грузится»):
 * EXIF-поворот, ≤ 2560 px, тот же формат с разумным сжатием. GIF не трогаем (анимация). Лёгкие файлы — как есть.
 * Сбой не фатален: остаётся исходный файл. Возвращает новый размер в байтах или null, если файл не менялся.
 */
export async function shrinkInPlace(path: string, mimetype: string, size: number): Promise<number | null> {
  if (mimetype === 'image/gif') return null;
  try {
    const raw = await fs.readFile(path); // из буфера: sharp не держит файл открытым (Windows не даёт его перезаписать)
    const meta = await sharp(raw).metadata();
    const side = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (side <= SHRINK_MAX_SIDE && size <= SHRINK_MAX_BYTES) return null;
    let p = sharp(raw).rotate().resize({ width: SHRINK_MAX_SIDE, height: SHRINK_MAX_SIDE, fit: 'inside', withoutEnlargement: true });
    if (mimetype === 'image/png') p = p.png({ compressionLevel: 9, effort: 8 });
    else if (mimetype === 'image/webp') p = p.webp({ quality: 85 });
    else if (mimetype === 'image/avif') p = p.avif({ quality: 60 });
    else p = p.jpeg({ quality: 85, mozjpeg: true });
    const data = await p.toBuffer();
    if (data.length >= size && side <= SHRINK_MAX_SIDE) return null; // сжатие не помогло — оставляем исходный
    await fs.writeFile(path, data);
    return data.length;
  } catch {
    return null;
  }
}
