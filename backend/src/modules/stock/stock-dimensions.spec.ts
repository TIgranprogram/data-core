import { sectionProfile, compareDimensions } from './stock-dimensions';
import { dimsOf, mergeDims } from './metal';
import { StockSearchService } from './stock-search.service';
import { scopeOfZones } from '../../common/stock-scope';
import { Types } from 'mongoose';

const pipe = (assortment: string, dims = {}) => ({ metal: 'pipe', assortment, dims });

describe('C242 — чистое сечение и размерный порядок', () => {
  it.each(['40×20×2', '40 x 20 x 2 мм', 'Труба профильная 40х20х2', '40*20*2'])('строго распознаёт %s', (text) => {
    expect(sectionProfile(pipe(text))).toMatchObject({ shape: 'rect', widthMm: 40, heightMm: 20, wallMm: 2, state: 'complete', label: '40×20×2' });
  });
  it('распознаёт круг/запятую, не переставляет B/H и не дополняет неполное', () => {
    expect(sectionProfile(pipe('Труба Ø21,3×1'))).toMatchObject({ shape: 'round', diameterMm: 21.3, wallMm: 1, label: 'Ø21,3×1', state: 'complete' });
    expect(sectionProfile(pipe('20×40×2'))).toMatchObject({ widthMm: 20, heightMm: 40 });
    expect(sectionProfile(pipe('40×1,5'))).toMatchObject({ state: 'incomplete' });
    expect(sectionProfile(pipe('40×20'))).not.toHaveProperty('wallMm');
  });
  it('не извлекает длину, ГОСТ и марку; прочий материал не получает профиль трубы', () => {
    for (const text of ['40×20×2 6 м', '40×20×2 ГОСТ 8645', 'AISI304 40×20×2', 'Ст3 40×20×2', '100500']) {
      expect(sectionProfile(pipe(text))).toMatchObject({ shape: 'unknown', state: 'unknown', label: text });
    }
    expect(sectionProfile({ metal: 'sheet', assortment: '40×20×2' })).toBeUndefined();
  });
  it('совмещает подтверждённые оси, отмечает конфликт и невозможную стенку', () => {
    expect(sectionProfile(pipe('40×20×2', { thickness: 2 }))).toMatchObject({ state: 'complete', source: 'mixed' });
    expect(sectionProfile(pipe('40×20×2', { width: 50 }))).toMatchObject({ state: 'conflict', label: '40×20×2' });
    expect(sectionProfile(pipe('40×20×12'))).toMatchObject({ state: 'conflict' });
    expect(sectionProfile(pipe('', { width: 40, height: 20, thickness: 2 }))).toMatchObject({ state: 'complete', source: 'dimensions' });
    expect(compareDimensions(pipe('20×40×2'), pipe('100×20×3'), 'width', 1)).toBeLessThan(0);
    expect(compareDimensions(pipe('20×40×2'), pipe('100×20×3'), 'height', 1)).toBeGreaterThan(0);
  });
  it('сохраняет оси, immutable и неизвестные расширения при частичной правке', () => {
    const before = [{ type: 'height', value: 60, isImmutable: true, tag: 'source' }, { type: 'length', value: 6000, isImmutable: true }, { type: 'depth', value: 8 }, { type: 'other', value: 77, custom: true }];
    const snapshot = JSON.stringify(before);
    expect(dimsOf(before)).toEqual({ height: 60, length: 6000, depth: 8 });
    expect(mergeDims(before, { length: 2000 })).toEqual([before[0], { ...before[1], value: 2000 }, before[2], before[3]]);
    expect(mergeDims(before, { length: null })).toEqual([before[0], before[2], before[3]]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
  it('числовые кортежи, формы фиксированы, неполное/конфликт в конце при asc/desc', () => {
    const rows = ['100×100×3', '40×40×2,5', '20×20×2', '40×40×2', 'Ø10×1', '40×20', '40×40×99'].map((text) => pipe(text));
    const sorted = (dir: number) => [...rows].sort((a, b) => compareDimensions(a, b, 'sectionSize', dir)).map((r) => r.assortment);
    expect(sorted(1).slice(0, 5)).toEqual(['20×20×2', '40×40×2', '40×40×2,5', '100×100×3', 'Ø10×1']);
    expect(sorted(-1).slice(0, 5)).toEqual(['100×100×3', '40×40×2,5', '40×40×2', '20×20×2', 'Ø10×1']);
    for (const dir of [1, -1]) expect(sorted(dir).slice(5)).toEqual(['40×20', '40×40×99']);
  });
  it('лист(t,W,L), дерево(W,H,L) и отдельные оси не получают ноль вместо неизвестного', () => {
    const a = { dims: { thickness: 2, width: 1250, length: 2500, height: 60 } };
    const b = { dims: { thickness: 3, width: 1000, length: 2000, height: 100 } };
    expect(compareDimensions(a, b, 'sheetSize', 1)).toBeLessThan(0);
    expect(compareDimensions(a, b, 'woodSize', 1)).toBeGreaterThan(0);
    for (const key of ['height', 'length', 'diameter']) for (const dir of [1, -1]) {
      const known = { dims: { [key]: 20 } };
      expect(compareDimensions(known, { dims: {} }, key, dir)).toBeLessThan(0);
    }
  });
});

describe('C242 — поиск нулевой номенклатуры без создания строк', () => {
  it.each(['80×60×3', '80х60х3', '80x60x3', '80 * 60 * 3', '80 х 60 х 3,0'])('находит существующую80×60×3: %s', async (search) => {
    const id = new Types.ObjectId('6ae45d4ad29aaee2976a2717'), cat = new Types.ObjectId();
    const material = { _id: id, name: 'Труба профильная80 × 60 × 3, не мытая,6м', assortment: 'Труба80×60×3', categoryId: cat, unit: 'м', dimensions: [{ type: 'length', value: 6000 }, { type: 'thickness', value: 3 }], photoIds: [] };
    const read = jest.fn((name: string) => ({ find: (filter: Record<string, unknown>) => ({ toArray: async () => name === 'categories' ? [{ _id: cat, name: 'Профильная труба' }] : name === 'materials' && !filter.offcutOf ? [material] : [] }) }));
    const storageFind = jest.fn(() => { const chain = { setOptions: () => chain, lean: () => chain, exec: async () => [] }; return chain; });
    const svc = Object.create(StockSearchService.prototype) as StockSearchService;
    Object.assign(svc, { connection: { db: { collection: read } }, storage: { find: storageFind }, core: { defaultWarehouse: async () => ({ _id: new Types.ObjectId(), name: 'Склад' }) }, photoMap: async () => new Map() });
    const scope = scopeOfZones([{ id: 'pipe', categoryIds: [String(cat)] }]);
    const result = await svc.listItems({ search, sort: 'sectionSize' }, scope);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: String(id), unit: 'м', quantity: 0, storageItemId: null, dims: { length: 6000, thickness: 3 }, sectionProfile: { label: '80×60×3', state: 'complete' } });
    expect((await svc.lookup(scope)).items.map((r) => r.id)).toEqual([String(id)]);
    const outside = scopeOfZones([{ id: 'other', categoryIds: ['other'] }]);
    expect((await svc.listItems({ search }, outside)).total).toBe(0);
    // Все подставленные коллекции имеют только find: любое создание/изменение сразу сломает сценарий.
  });
});

describe('C242 — весь scope до страниц, нули и отсутствие записи', () => {
  const row = (n: number, id = String(n)) => ({ ...pipe(`${n}×${n}×2`), id, materialId: id, name: `Труба ${n}`, categoryId: 'pipe', quantity: n === 80 ? 0 : n, reservedQty: n === 40 ? 40 : 0, free: n === 40 ? 0 : n, minQuantity: 0, ordered: 0, status: n === 80 ? 'none' : 'ok', photoIds: [], offcuts: [] });
  const service = (rows: ReturnType<typeof row>[]) => {
    const svc = Object.create(StockSearchService.prototype) as StockSearchService;
    Object.assign(svc, { connection: { db: { collection: jest.fn(() => ({ find: jest.fn(() => ({ toArray: async () => [] })) })) } }, itemRows: jest.fn(async (_q, _deleted, _tokens, held) => ({ wh: { _id: 'w', name: 'Склад' }, rows: held ? rows.filter((r) => r.quantity > 0) : rows })), photoMap: jest.fn(async () => new Map()) });
    return svc;
  };
  it('сортирует до page; priority не ломает размеры; общий кэш/остатки не мутируют', async () => {
    const rows = [row(100), row(20), row(80), row(40)];
    // Бронь проверяется только для страницы: здесь отдельные фото/бронь не нужны.
    rows[3].reservedQty = 0;
    const snapshot = JSON.stringify(rows), svc = service(rows);
    const first = await svc.listItems({ sort: 'sectionSize', limit: 2, priority: '1' });
    const second = await svc.listItems({ sort: 'sectionSize', limit: 2, page: 2, priority: '1' });
    expect(first.items.map((r) => r.materialId)).toEqual(['20', '40']);
    expect(second.items.map((r) => r.materialId)).toEqual(['80', '100']);
    expect(second.items[0]).toMatchObject({ quantity: 0, status: 'none' });
    expect(second.total).toBe(4);
    expect(JSON.stringify(rows)).toBe(snapshot);
    expect((await svc.listItems({ sort: '-sectionSize', limit: 2 })).items.map((r) => r.materialId)).toEqual(['100', '80']);
  });
  it('нули в items/lookup/categories, явный held исключает; чужая зона остаётся закрыта', async () => {
    const rows = [row(80), { ...row(100), categoryId: 'other' }], svc = service(rows);
    const scope = scopeOfZones([{ id: 'z', categoryIds: ['pipe'] }]);
    expect((await svc.listItems({ hideEmptyMetal: '1' }, scope)).items.map((r) => r.id)).toEqual(['80']);
    expect((await svc.lookup(scope)).items.map((r) => r.id)).toEqual(['80']);
    expect((await svc.lookup()).items).toHaveLength(2);
    expect((await svc.categorySummary(scope)).total).toBe(1);
    expect((await svc.listItems({ held: '1' }, scope)).total).toBe(0);
    expect((await svc.listItems({ status: 'none' })).total).toBe(1);
  });
  it('полностью забронированный физический остаток виден и остаётся неизменным', async () => {
    const id = '6ae45d4ad29aaee2976a2717';
    const rows = [row(40, id)], before = JSON.stringify(rows), svc = service(rows);
    const result = await svc.listItems({ held: '1', sort: 'sectionSize' });
    expect(result.items[0]).toMatchObject({ quantity: 40, reservedQty: 40, free: 0 });
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('не теряет позиции за старой первой страницей10000; сортировка одна для всего набора', async () => {
    const rows = Array.from({ length: 10123 }, (_, i) => ({ ...row(i + 10), reservedQty: 0 })).reverse();
    const svc = service(rows);
    const page = await svc.listItems({ sort: 'sectionSize', limit: 1000, page: 11 });
    expect(page.total).toBe(10123);
    expect(page.items).toHaveLength(123);
    expect(page.items[0].materialId).toBe('10010');
    expect(page.items.at(-1)?.materialId).toBe('10132');
    expect((svc as unknown as { itemRows: jest.Mock }).itemRows).toHaveBeenCalledTimes(1);
  });
  it('availability=in оставляет полностью забронированное, none только физический0; counts прежние', async () => {
    const rows = [row(80), row(40, '6ae45d4ad29aaee2976a2717'), row(100)];
    const before = JSON.stringify(rows), svc = service(rows);
    const available = await svc.listItems({ availability: 'in', sort: 'sectionSize' });
    expect(available.items.map((r) => r.quantity)).toEqual([40, 100]);
    expect(available.items[0]).toMatchObject({ reservedQty: 40, free: 0 });
    expect(available.total).toBe(2);
    expect(available.counts).toMatchObject({ all: 3, none: 1, reserved: 1 });
    const absent = await svc.listItems({ availability: 'none' });
    expect(absent.items.map((r) => r.quantity)).toEqual([0]);
    expect(absent.total).toBe(1);
    expect(absent.counts).toEqual(available.counts);
    expect((await svc.listItems({})).total).toBe(3);
    expect((await svc.listItems({ held: '1', availability: 'none' })).total).toBe(0);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('availability — AND со status/scope до страниц; кэшированные строки неизменны', async () => {
    const rows = [row(80, 'zero2'), row(100), row(80, 'zero1'), { ...row(80, 'foreign'), categoryId: 'other' }];
    const before = JSON.stringify(rows), svc = service(rows), scope = scopeOfZones([{ id: 'pipe', categoryIds: ['pipe'] }]);
    const first = await svc.listItems({ availability: 'none', status: 'none', sort: 'sectionSize', limit: 1 }, scope);
    const second = await svc.listItems({ availability: 'none', status: 'none', sort: 'sectionSize', limit: 1, page: 2 }, scope);
    expect(first.total).toBe(2);
    expect(first.items[0].materialId).toBe('zero1');
    expect(second.items[0].materialId).toBe('zero2');
    expect(first.counts.all).toBe(3);
    expect((await svc.listItems({ availability: 'in', status: 'none' }, scope)).total).toBe(0);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it.each(['', 'all', 'available', '0', null, false, 0, ['in']])('availability=%p отклоняется до чтений', async (availability) => {
    const svc = service([row(80)]);
    await expect(svc.listItems({ availability })).rejects.toMatchObject({ status: 400 });
    expect((svc as unknown as { itemRows: jest.Mock }).itemRows).not.toHaveBeenCalled();
  });
});
