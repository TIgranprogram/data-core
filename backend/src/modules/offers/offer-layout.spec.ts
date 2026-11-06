import { PAGE_H, paginateRows, placeBlock, zoneOf } from './offer-layout';

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

  it('зоны бланка: верх и низ берутся из бланка, без бланка — как раньше', () => {
    const own = { first: { textTop: 0.26, textBottom: 0.78 }, next: { textTop: 0.11, textBottom: 0.78 } };
    expect(zoneOf(0, own).top).toBeCloseTo(0.26 * PAGE_H);
    expect(zoneOf(1, own).bottom).toBeCloseTo(0.78 * PAGE_H);
    expect(zoneOf(0, { first: { textTop: null } })).toEqual(zoneOf(0));
    expect(zoneOf(1)).toEqual(zoneOf(1, {}));
  });

  it('узкая зона бланка даёт больше страниц и ничего не выходит за её низ', () => {
    const h = rows(20);
    const zones = { first: { textTop: 0.3, textBottom: 0.5 }, next: { textTop: 0.3, textBottom: 0.5 } };
    const r = paginateRows(h, zoneOf(0, zones).top, 22, 26, zones);
    expect(r.pages.length).toBeGreaterThan(paginateRows(h, 230, 22, 26).pages.length);
    expect(placeBlock(0, zoneOf(0, zones).bottom - 5, 30, zones)).toEqual({ page: 1, y: zoneOf(1, zones).top });
  });
});
