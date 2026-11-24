import { Types } from 'mongoose';
import { StockMovementsService } from './stock-movements.service';
import { StockSearchService } from './stock-search.service';

const flagsOn = { isEnabled: async () => true };

const q = (value: unknown) => { const chain = { lean: () => chain, session: () => chain, exec: async () => value }; return chain; };

function setup(quantities: number[], deleted = false) {
  const warehouseId = new Types.ObjectId(), materialId = new Types.ObjectId(), catId = new Types.ObjectId();
  const rows = quantities.map((quantity, i) => ({ _id: new Types.ObjectId(), warehouseId, materialId, quantity, reservedQty: 0, zoneName: String.fromCharCode(65 + i), ...(deleted && i === quantities.length - 1 ? { deletedAt: new Date() } : {}), save: jest.fn(async () => undefined) }));
  const session = { withTransaction: async (fn: () => Promise<void>) => { inside = true; try { await fn(); } finally { inside = false; } }, endSession: async () => undefined };
  let inside = false;
  const updates = jest.fn(async () => ({})), find = jest.fn((filter: Record<string, unknown>, options: Record<string, unknown>) => {
    expect(inside).toBe(true);
    expect(options.session).toBe(session);
    expect(filter).toEqual({ warehouseId, materialId: { $in: [materialId] }, deletedAt: null });
    return { toArray: async () => rows.filter((r) => !('deletedAt' in r)) };
  });
  const material = { _id: materialId, name: 'Труба', categoryId: catId, unit: 'м', photoIds: [] };
  const db = { collection: (name: string) => name === 'storageitems' ? { find, updateOne: updates } : { updateOne: updates, updateMany: updates, find: (filter: Record<string, unknown>) => ({ toArray: async () => name === 'materials' && !filter.offcutOf ? [material] : name === 'categories' ? [{ _id: catId, name: 'Трубы' }] : [] }) } };
  const connection = { db, startSession: async () => session };
  const storageCreate = jest.fn();
  const core = { defaultWarehouse: async () => ({ _id: warehouseId, name: 'Склад' }), markEdited: jest.fn(async () => undefined), loadStorage: jest.fn(async () => {
    const found = rows.find((r) => !('deletedAt' in r));
    if (found) return found;
    const created = { _id: new Types.ObjectId(), warehouseId, materialId, quantity: 0, reservedQty: 0, zoneName: '', save: jest.fn(async () => undefined) };
    rows.push(created); storageCreate(); return created;
  }) };
  const movements = { create: jest.fn(async () => []), exists: async () => false }, reservations = { exists: async () => false };
  const materials = { exists: async () => true, find: () => q([material]) };
  const search = { getItem: async () => ({ id: String(materialId) }), listItems: async () => ({ items: [{ id: String(materialId) }] }) };
  const svc = new StockMovementsService(connection as never, movements as never, reservations as never, materials as never, core as never, search as never, {} as never, flagsOn as never);
  const reader = Object.create(StockSearchService.prototype) as StockSearchService;
  const storage = { find: () => { const chain = { setOptions: () => chain, lean: () => chain, exec: async () => rows.filter((r) => !('deletedAt' in r)) }; return chain; } };
  Object.assign(reader, { connection, core, storage, photoMap: async () => new Map() });
  return { svc, reader, rows, materialId, core, find, updates, movements, storageCreate };
}

describe('C242 — пересчёт не адресует агрегат нескольких ячеек', () => {
  it.each([{ quantities: [] }, { quantities: [3] }, { quantities: [3, 2] }])('GET суммирует $quantities и явно сообщает countMode', async ({ quantities }) => {
    const t = setup(quantities);
    const result = await t.reader.listItems();
    expect(result.items[0]).toMatchObject({ quantity: quantities.reduce((sum, n) => sum + n, 0), countMode: quantities.length > 1 ? 'multiple' : 'single' });
    expect(t.storageCreate).not.toHaveBeenCalled();
  });
  it.each(['single', 'batch'])('%s count при двух ячейках и stale single→multiple:409 до любых изменений', async (mode) => {
    const t = setup([3, 2]), before = JSON.stringify(t.rows);
    const first = jest.fn(async () => undefined);
    const action = mode === 'single' ? t.svc.move(String(t.materialId), { type: 'count', qty: 6, expected: 5 }, undefined, first) : t.svc.batch({ type: 'count', lines: [{ materialId: String(t.materialId), qty: 6, expected: 5 }] });
    await expect(action).rejects.toMatchObject({ status: 409, message: expect.stringContaining('нескольких ячейках') });
    expect(t.find).toHaveBeenCalledTimes(1);
    expect(t.core.loadStorage).not.toHaveBeenCalled();
    expect(t.storageCreate).not.toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
    expect(t.movements.create).not.toHaveBeenCalled();
    expect(t.updates).not.toHaveBeenCalled();
    expect(t.core.markEdited).not.toHaveBeenCalled();
    expect(JSON.stringify(t.rows)).toBe(before);
  });
  it.each([{ quantities: [] }, { quantities: [3] }, { quantities: [3, 2] }])('single count сохраняет0/1live; deletedстрока не делает multiple: $quantities', async ({ quantities }) => {
    const t = setup(quantities, quantities.length === 2);
    await t.svc.move(String(t.materialId), { type: 'count', qty: 6, expected: quantities.length ? 3 : 0 });
    expect(t.rows[0].quantity).toBe(6);
    expect(t.movements.create).toHaveBeenCalledTimes(1);
    expect(t.core.markEdited).toHaveBeenCalledTimes(1);
    if (quantities.length === 2) expect(t.rows[1].quantity).toBe(2);
  });
  it.each([{ quantities: [] }, { quantities: [3] }, { quantities: [3, 2] }])('batch count сохраняет0/1live; deletedстрока не делает multiple: $quantities', async ({ quantities }) => {
    const t = setup(quantities, quantities.length === 2);
    await t.svc.batch({ type: 'count', lines: [{ materialId: String(t.materialId), qty: 6, expected: quantities.length ? 3 : 0 }] });
    expect(t.rows[0].quantity).toBe(6);
    expect(t.movements.create).toHaveBeenCalledTimes(1);
    if (quantities.length === 2) expect(t.rows[1].quantity).toBe(2);
  });
  it('другие движения не получают запрет пересчёта', async () => {
    const t = setup([3, 2]);
    await t.svc.move(String(t.materialId), { type: 'in', qty: 1 });
    expect(t.find).not.toHaveBeenCalled();
    expect(t.rows.map((r) => r.quantity)).toEqual([4, 2]);
  });
  it('stale single→multiple отклонён, даже когда expected совпадает с первой ячейкой', async () => {
    const t = setup([3]);
    expect((await t.reader.listItems()).items[0]).toMatchObject({ quantity: 3, countMode: 'single' });
    t.rows.push({ ...t.rows[0], _id: new Types.ObjectId(), quantity: 2, zoneName: 'B', save: jest.fn(async () => undefined) });
    await expect(t.svc.move(String(t.materialId), { type: 'count', qty: 6, expected: 3 })).rejects.toMatchObject({ status: 409 });
    expect(t.rows.map((r) => r.quantity)).toEqual([3, 2]);
    expect(t.movements.create).not.toHaveBeenCalled();
    expect(t.updates).not.toHaveBeenCalled();
  });
  it('GET 1live+deleted остаётся single и не включает удалённое количество', async () => {
    const t = setup([3, 2], true);
    expect((await t.reader.listItems()).items[0]).toMatchObject({ quantity: 3, countMode: 'single' });
  });
});
