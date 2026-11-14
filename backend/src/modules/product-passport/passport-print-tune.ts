import sharp from 'sharp';

/**
 * Подготовка паспорта к печати (пользователь 14.11):
 *  - название изделия — как в договоре (строка заказа), даже если паспорт выпущен до переименования;
 *  - блёклый рисунок из САПР (светлые линии на белом) — с растянутым контрастом, иначе на бумаге почти не виден.
 * Хранимый паспорт не меняется — только копия для PDF.
 */

type Doc = Record<string, unknown>;

/** Замена старого названия на новое во всех строках снимка (с точкой на конце и без: «… м.п.» / «… м.п (далее — изделие)»). */
export function renameDeep<T>(v: T, from: string, to: string): T {
  const olds = [...new Set([from, from.replace(/\.+$/, '')])].filter((s) => s.trim().length >= 3).sort((a, b) => b.length - a.length);
  if (!olds.length || from === to) return v;
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') { let s = x; for (const o of olds) s = s.split(o).join(to); return s; }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object' && !(x instanceof Date) && !Buffer.isBuffer(x) && x.constructor === Object) return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  return walk(v) as T;
}

/** Паспорт с названием из договора: { ...p, name, textSnapshot } — если строка заказа названа иначе. */
export function withContractName(p: Doc, contractTitle: unknown): Doc {
  const to = typeof contractTitle === 'string' ? contractTitle.trim() : '';
  const from = typeof p.name === 'string' ? p.name.trim() : '';
  if (!to || !from || to === from) return p;
  return { ...p, name: to, textSnapshot: renameDeep(p.textSnapshot, from, to) };
}

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
