import sharp from 'sharp';

/**
 * Блёклый рисунок (нет тёмных тонов, почти всё светлое) — растянуть яркость на весь диапазон.
 * Фото с тёмными местами не трогаем. Ошибка разбора — исходный рисунок.
 */
export async function boostFaint(buf: Buffer): Promise<Buffer> {
  try {
    const st = await sharp(buf).flatten({ background: '#ffffff' }).greyscale().stats();
    const ch = st.channels[0];
    const faint = ch.mean > 215 && ch.min > 70; // светлые линии на белом: ни одного по-настоящему тёмного пикселя
    if (!faint) return buf;
    // normalise: самый тёмный тон → чёрный; linear: полутона темнее, белый остаётся белым (255·1.15−38 ≥ 255)
    return await sharp(buf).flatten({ background: '#ffffff' }).normalise().linear(1.15, -38).png().toBuffer();
  } catch { return buf; }
}
