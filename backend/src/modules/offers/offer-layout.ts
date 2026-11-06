/** Раскладка таблицы КП по страницам (чистая функция, без pdfkit). Размеры — в пунктах PDF (А4 595.28×841.89). */
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;

/** Безопасные зоны фонов — доля высоты страницы: за ними подпись, печать и шапка фона. */
export const ZONE_FIRST = { top: 0.2, bottom: 0.72 };
export const ZONE_NEXT = { top: 0.04, bottom: 0.7 };

export interface Zone { top: number; bottom: number }

/** Зона текста, заданная бланком (доли высоты); пусто — ZONE_FIRST / ZONE_NEXT. */
export interface ZoneOverride { textTop?: number | null; textBottom?: number | null }
/** Зоны бланков: стр. 1 и стр. 2+. */
export interface Zones { first?: ZoneOverride | null; next?: ZoneOverride | null }

export const zoneOf = (page: number, zones?: Zones): Zone => {
  const base = page === 0 ? ZONE_FIRST : ZONE_NEXT;
  const own = page === 0 ? zones?.first : zones?.next;
  return { top: (own?.textTop ?? base.top) * PAGE_H, bottom: (own?.textBottom ?? base.bottom) * PAGE_H };
};

/**
 * Разбивка строк таблицы по страницам. `startY` — где на стр. 1 начинается таблица (после шапки КП),
 * `headH` — высота заголовка таблицы (повторяется на каждой странице), `tailH` — высота блока «Итого».
 * Строка не разрывается; «Итого» не остаётся один: не влез — на новую страницу уходит и последняя строка.
 * Возвращает индексы строк по страницам (`pages.length` ≥ 1) и y конца таблицы на последней странице.
 */
export function paginateRows(heights: number[], startY: number, headH: number, tailH: number, zones?: Zones): { pages: number[][]; endY: number } {
  const pages: number[][] = [[]];
  let y = startY + headH;
  const bottom = (p: number) => zoneOf(p, zones).bottom;
  heights.forEach((h, i) => {
    const p = pages.length - 1;
    if (y + h > bottom(p) && pages[p].length) {
      pages.push([]);
      y = zoneOf(p + 1, zones).top + headH;
    }
    pages[pages.length - 1].push(i);
    y += h;
  });
  let p = pages.length - 1;
  if (y + tailH > bottom(p) && pages[p].length > 1) {
    const last = pages[p].pop()!;
    pages.push([last]);
    p += 1;
    y = zoneOf(p, zones).top + headH + heights[last];
  } else if (y + tailH > bottom(p)) {
    // одна строка на странице и «Итого» не влезает: «Итого» переносится вместе с началом блока условий на следующую
    p = pages.length;
    pages.push([]);
    y = zoneOf(p, zones).top;
  }
  return { pages, endY: y };
}

/** Следующая позиция текстового блока высотой `h` с y: влез — тот же лист, нет — начало следующего. */
export function placeBlock(page: number, y: number, h: number, zones?: Zones): { page: number; y: number } {
  if (y + h <= zoneOf(page, zones).bottom) return { page, y };
  return { page: page + 1, y: zoneOf(page + 1, zones).top };
}
