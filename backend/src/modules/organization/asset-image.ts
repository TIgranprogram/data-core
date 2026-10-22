import sharp from 'sharp';

/** Максимум по большей стороне после нормализации (печать/подпись/логотип): в PDF они 3–5 см, 800 px — с запасом для печати. */
export const ASSET_MAX_SIDE = 800;
/** Яркость, с которой пиксель целиком прозрачный / начинает становиться прозрачным. */
export const WHITE_FULL = 235;
export const WHITE_SOFT = 200;

/**
 * Чистая функция над сырыми RGBA-байтами: светлые пиксели → прозрачные.
 * яркость ≥ 235 — альфа 0; 200..235 — плавный край (альфа по яркости); темнее — не трогаем.
 */
export function clearWhiteRgba(rgba: Buffer): Buffer {
  const out = Buffer.from(rgba);
  for (let i = 0; i + 3 < out.length; i += 4) {
    const lum = 0.299 * out[i]! + 0.587 * out[i + 1]! + 0.114 * out[i + 2]!;
    if (lum >= WHITE_FULL) out[i + 3] = 0;
    else if (lum > WHITE_SOFT) out[i + 3] = Math.round(out[i + 3]! * ((WHITE_FULL - lum) / (WHITE_FULL - WHITE_SOFT)));
  }
  return out;
}

/**
 * EXIF-поворот → уменьшение до ≤ 800 px → (опц.) «убрать белый фон» → PNG с палитрой (у печати и подписи мало цветов —
 * файл в разы легче: 1,4 МБ → ~100 КБ; без этого каждый PDF и карточка компании тянули тяжёлый файл).
 * Оригинал не меняется: вызывающий кладёт результат в новый файл.
 */
export async function normalizeAssetImage(
  input: Buffer | string,
  opts: { clearWhite?: boolean } = {},
): Promise<{ data: Buffer; width: number; height: number }> {
  let pipeline = sharp(input)
    .rotate()
    .resize({ width: ASSET_MAX_SIDE, height: ASSET_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha();
  if (opts.clearWhite) {
    const raw = await pipeline.raw().toBuffer({ resolveWithObject: true });
    const cleared = clearWhiteRgba(raw.data);
    pipeline = sharp(cleared, { raw: { width: raw.info.width, height: raw.info.height, channels: 4 } });
  }
  const out = await pipeline.png({ palette: true, quality: 90, compressionLevel: 9, effort: 8 }).toBuffer({ resolveWithObject: true });
  return { data: out.data, width: out.info.width, height: out.info.height };
}
