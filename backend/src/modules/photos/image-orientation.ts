import sharp from 'sharp';

export interface OrientedImage {
  /** Исходная EXIF-ориентация (1..8). */
  orientation: number;
  /** Повёрнутая копия; null, если поворот не нужен (orientation 1 или нет EXIF). */
  rotated: { data: Buffer; format: 'jpeg' | 'png' | 'webp'; ext: string; width: number; height: number } | null;
}

/**
 * Чистая функция: по байтам оригинала определяет EXIF-ориентацию и, если она ≠ 1,
 * строит физически повёрнутую копию. Оригинал не меняется.
 */
export async function buildRotatedCopy(input: Buffer | string): Promise<OrientedImage> {
  const meta = await sharp(input).metadata();
  const orientation = meta.orientation ?? 1;
  if (orientation === 1) return { orientation, rotated: null };
  const format: 'jpeg' | 'png' | 'webp' =
    meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpeg';
  const pipeline = sharp(input).rotate();
  const out = await (format === 'png'
    ? pipeline.png()
    : format === 'webp'
      ? pipeline.webp({ quality: 90 })
      : pipeline.jpeg({ quality: 90 })
  ).toBuffer({ resolveWithObject: true });
  return {
    orientation,
    rotated: {
      data: out.data,
      format,
      ext: format === 'jpeg' ? 'jpg' : format,
      width: out.info.width,
      height: out.info.height,
    },
  };
}
