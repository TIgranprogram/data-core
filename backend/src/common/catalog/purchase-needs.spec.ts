import { computeNeeds, flattenNeeds, NeedsMaterial, NeedsTreeNode } from './purchase-needs';

const node = (_id: string, kind: string, quantity: number, children: NeedsTreeNode[] = []): NeedsTreeNode => ({ _id, kind, quantity, children });
const dims = (length: number, width?: number) => [{ type: 'length', value: length }, ...(width ? [{ type: 'width', value: width }] : [])];

const sheet: NeedsMaterial = { id: 'S4', name: 'Лист 4 мм', unit: 'м²', materialKind: 'raw', isProfile: true, scrapFactor: 1.1 };
const list: NeedsMaterial = { id: 'F1', name: 'Лист 1250×2500', materialKind: 'raw', profileId: 'S4', stockQty: 1, isDefaultFormat: true, dimensions: dims(2500, 1250) };
const part = (id: string): NeedsMaterial => ({ id, name: `Деталь ${id}`, article: `A-${id}`, materialKind: 'part' });
const washer: NeedsMaterial = { id: 'W', name: 'Шайба', unit: 'шт', materialKind: 'fastener', stockQty: 3 };
const all = (...m: NeedsMaterial[]) => new Map(m.map((x) => [x.id, x]));

describe('purchase-needs', () => {
  it('умножает количества по пути: изделие × модуль × деталь × сырьё', () => {
    const tree = node('P', 'product', 1, [
      node('M', 'module', 2, [node('D1', 'material', 3, [node('S4', 'material', 0.5)])]),
      node('W', 'material', 8),
    ]);
    const { totals, parts } = flattenNeeds(tree, 10);
    expect(totals.get('S4')).toBe(10 * 2 * 3 * 0.5);
    expect(totals.get('W')).toBe(80);
    expect(parts.get('D1')).toBe(true);
  });

  it('сырьё: × отходы, − остатки формата, округление вверх до листов', () => {
    // нужно 10 м² × 1.1 = 11; есть 1 лист = 3.125 м²; не хватает 7.875 → 3 листа
    const r = computeNeeds(new Map([['S4', 10]]), new Map(), all(sheet), [list]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ materialId: 'S4', need: 11, have: 3.125, buy: 3, buyUnit: 'шт', format: { id: 'F1', name: 'Лист 1250×2500' } });
  });

  it('остатка хватает — покупать 0; основной формат важнее первого', () => {
    const small: NeedsMaterial = { id: 'F0', name: 'Малый', profileId: 'S4', stockQty: 0, dimensions: dims(1000, 1000) };
    const r = computeNeeds(new Map([['S4', 2]]), new Map(), all(sheet), [small, { ...list, stockQty: 5 }]);
    expect(r.items[0]).toMatchObject({ buy: 0, format: { id: 'F1' } });
  });

  it('труба считается в метрах по длине формата', () => {
    const pipe: NeedsMaterial = { id: 'T', name: 'Труба', unit: 'м', isProfile: true, materialKind: 'raw' };
    const six: NeedsMaterial = { id: 'T6', name: 'Труба 6 м', profileId: 'T', stockQty: 1, dimensions: dims(6000) };
    const r = computeNeeds(new Map([['T', 13]]), new Map(), all(pipe), [six]);
    expect(r.items[0]).toMatchObject({ need: 13, have: 6, buy: 2, buyUnit: 'шт' });
  });

  it('нет формата на складе — в м² и пометка', () => {
    const r = computeNeeds(new Map([['S4', 10]]), new Map(), all(sheet), []);
    expect(r.items[0]).toMatchObject({ need: 11, have: 0, buy: 11, buyUnit: 'м²' });
    expect(r.items[0].format).toBeUndefined();
    expect(r.items[0].note).toContain('Нет формата');
  });

  it('метизы: нужно − остаток; сначала сырьё, потом метизы', () => {
    const r = computeNeeds(new Map([['W', 8], ['S4', 1]]), new Map(), all(washer, sheet), [list]);
    expect(r.items.map((i) => i.materialId)).toEqual(['S4', 'W']);
    expect(r.items[1]).toMatchObject({ need: 8, have: 3, buy: 5, buyUnit: 'шт' });
  });

  it('деталь без строки сырья — в списке «нет размера заготовки», в покупках её нет', () => {
    const tree = node('P', 'product', 1, [node('D1', 'material', 2), node('D2', 'material', 1, [node('S4', 'material', 1)])]);
    const { totals, parts } = flattenNeeds(tree, 1);
    const r = computeNeeds(totals, parts, all(part('D1'), part('D2'), sheet), [list]);
    expect(r.missingBlank).toEqual([{ id: 'D1', article: 'A-D1', name: 'Деталь D1' }]);
    expect(r.items.map((i) => i.materialId)).toEqual(['S4']);
  });

  it('одна и та же позиция из разных веток складывается', () => {
    const tree = node('P', 'product', 1, [node('M', 'module', 1, [node('W', 'material', 2)]), node('W', 'material', 3)]);
    expect(flattenNeeds(tree, 2).totals.get('W')).toBe(10);
  });
});
