import { paginateRows, placeBlock, zoneOf } from './offer-layout';

describe('КП: раскладка таблицы по страницам', () => {
  const rows = (n: number, h = 24) => Array.from({ length: n }, () => h);

  it('мало строк — одна страница', () => {
    const r = paginateRows(rows(3), 230, 22, 26);
    expect(r.pages).toEqual([[0, 1, 2]]);
  });

  it('40 строк — не меньше трёх страниц, ничего ниже нижней зоны, все строки на месте', () => {
    const h = rows(40);
    const r = paginateRows(h, 230, 22, 26);
    expect(r.pages.length).toBeGreaterThanOrEqual(3);
    expect(r.pages.flat()).toEqual(h.map((_, i) => i));
    r.pages.forEach((idxs, p) => {
      const top = p === 0 ? 230 : zoneOf(p).top;
      expect(top + 22 + idxs.reduce((s, i) => s + h[i], 0)).toBeLessThanOrEqual(zoneOf(p).bottom + 1e-6);
    });
    expect(r.endY + 26).toBeLessThanOrEqual(zoneOf(r.pages.length - 1).bottom + 1e-6);
  });

  it('«Итого» не остаётся одно: уходит на новую страницу вместе с последней строкой', () => {
    // подбираем высоту так, чтобы строки влезли впритык, а «Итого» — нет
    const z = zoneOf(0);
    const startY = 230, head = 22, avail = z.bottom - startY - head;
    const h = [avail / 2, avail / 2];
    const r = paginateRows(h, startY, head, 26);
    expect(r.pages).toEqual([[0], [1]]);
  });

  it('текстовый блок, не влезающий в зону, переносится на следующую страницу', () => {
    const z = zoneOf(0);
    expect(placeBlock(0, z.bottom - 10, 30)).toEqual({ page: 1, y: zoneOf(1).top });
    expect(placeBlock(0, 300, 30)).toEqual({ page: 0, y: 300 });
  });
});
