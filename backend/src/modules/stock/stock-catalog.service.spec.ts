import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';
import { scopeOfZones } from '../../common/stock-scope';
import type { CounterService } from '../counter/counter.service';
import type { MaterialDocument } from '../material/material.schema';
import type { QrService } from '../qr/qr.service';
import type { StorageItemDocument } from './schemas/storage-item.schema';
import { StockCatalogService } from './stock-catalog.service';
import type { StockCatalogNameService } from './stock-catalog-name.service';
import type { StockCoreService } from './stock-core.service';
import type { StockSearchService } from './stock-search.service';

type Doc = Record<string, unknown> & { _id: Types.ObjectId; name: string };
function make(initial: Doc[] = []) {
  const docs = [...initial];
  const session = {} as ClientSession;
  const events: string[] = [];
  const chain = <T>(work: () => T) => {
    type Q = { session: jest.Mock; setOptions: () => Q; lean: () => Q; exec: () => Promise<T> };
    const q: Q = { session: jest.fn(() => q), setOptions: () => q, lean: () => q, exec: async () => work() };
    return q;
  };
  const hits = (d: Doc, f: Record<string, unknown>) => {
    if (f.deletedAt === null && d.deletedAt != null) return false;
    if ((f.deletedAt as { $ne?: unknown } | undefined)?.$ne === null && d.deletedAt == null) return false;
    if (f.name instanceof RegExp && !f.name.test(d.name)) return false;
    if (f.article instanceof RegExp && !f.article.test(String(d.article))) return false;
    if (f._id instanceof Types.ObjectId && String(f._id) !== String(d._id)) return false;
    const ne = (f._id as { $ne?: Types.ObjectId } | undefined)?.$ne;
    return !ne || String(ne) !== String(d._id);
  };
  const queries: Array<ReturnType<typeof chain>> = [];
  const materials = {
    findOne: jest.fn((f: Record<string, unknown>) => {
      const q = chain(() => { events.push('find'); return docs.find((d) => hits(d, f)) ?? null; });
      queries.push(q);
      return q;
    }),
    create: jest.fn(async (rows: Array<Record<string, unknown>>, _options: unknown) => {
      void _options;
      events.push('create');
      const created = rows.map((row) => ({ _id: new Types.ObjectId(), ...row }) as Doc);
      docs.push(...created);
      return created;
    }),
    updateOne: jest.fn((f: Record<string, unknown>, u: { $set: Record<string, unknown> }, _options?: unknown) => chain(() => {
      void _options;
      events.push('update');
      const d = docs.find((doc) => hits(doc, f));
      if (d) Object.assign(d, u.$set);
      return { matchedCount: d ? 1 : 0 };
    })),
  };
  const raw = { updateOne: jest.fn(async () => ({})), findOne: jest.fn(async () => null), findOneAndUpdate: jest.fn(async () => ({ seq: 1 })) };
  const connection = { db: { collection: jest.fn(() => raw) } };
  const storage = {
    updateOne: jest.fn((_f: unknown, _u: unknown, _o: unknown) => chain(() => { void [_f, _u, _o]; events.push('storage'); return {}; })),
    updateMany: jest.fn(() => chain(() => ({}))),
  };
  const wh = new Types.ObjectId();
  const core = { defaultWarehouse: jest.fn(async () => ({ _id: wh })), markEdited: jest.fn(async () => undefined), setWeightG: jest.fn(async () => undefined) };
  const names = {
    acquire: jest.fn(async (_names: string[], _s: ClientSession) => { void [_names, _s]; events.push('reserve'); }),
    run: jest.fn(async (keys: string[], work: (s: ClientSession) => Promise<unknown>) => {
      await names.acquire(keys, session);
      const result = await work(session);
      events.push('commit');
      return result;
    }),
  };
  const search = { getItem: jest.fn(async (id: string) => ({ id })) };
  const qr = { ensureCode: jest.fn(async () => undefined) };
  const counter = { next: jest.fn(async () => 'outside-counter') };
  const service = new StockCatalogService(connection as unknown as Connection, storage as unknown as Model<StorageItemDocument>, materials as unknown as Model<MaterialDocument>, counter as unknown as CounterService, core as unknown as StockCoreService, search as unknown as StockSearchService, names as unknown as StockCatalogNameService, qr as unknown as QrService);
  return { service, docs, materials, names, events, session, storage, core, qr, raw, counter, queries };
}
const doc = (name: string, extra: Record<string, unknown> = {}): Doc => ({ _id: new Types.ObjectId(), name, article: 'СКЛ-2026-001', unit: 'шт', ...extra });

describe('T26: StockCatalogService', () => {
  it.each(['', ' \t\n '])('пустое имя → 400 до транзакции', async (name) => {
    const { service, names } = make();
    await expect(service.createItem({ name })).rejects.toBeInstanceOf(BadRequestException);
    expect(names.run).not.toHaveBeenCalled();
  });

  it('повторный поиск и Material.create используют ту же session после revision', async () => {
    const h = make();
    await h.service.createItem({ name: '  Болт  M8 ', article: 'A8' });
    expect(h.names.run).toHaveBeenCalledWith(['Болт  M8'], expect.any(Function));
    expect(h.events.indexOf('reserve')).toBeLessThan(h.events.lastIndexOf('find'));
    expect(h.events.indexOf('reserve')).toBeLessThan(h.events.indexOf('create'));
    expect(h.materials.create).toHaveBeenCalledWith([expect.objectContaining({ name: 'Болт  M8', article: 'A8' })], { session: h.session });
    expect(h.queries[1].session).toHaveBeenCalledWith(h.session);
    expect(h.events.indexOf('commit')).toBeLessThan(h.events.indexOf('storage'));
  });

  it('автоартикул выделяется в основной session, не вложенной транзакцией', async () => {
    const h = make();
    await h.service.createItem({ name: 'Новое' });
    expect(h.counter.next).not.toHaveBeenCalled();
    expect(h.raw.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ entity: 'MaterialArticle', prefix: 'СКЛ' }), { $inc: { seq: 1 } }, expect.objectContaining({ session: h.session }));
    expect(h.docs[0].article).toMatch(/^СКЛ-\d{4}-001$/);
  });

  it('регистр/повторные пробелы переиспользуют id; invoiceName не перезаписывается', async () => {
    const existing = doc(' Болт\t M8 ', { invoiceName: 'Поставщик A' });
    const h = make([existing]);
    await expect(h.service.createItem({ name: 'болт  m8', unit: 'кг', invoiceName: 'Поставщик B' })).resolves.toEqual({ id: String(existing._id) });
    expect(h.materials.create).not.toHaveBeenCalled();
    expect(existing).toMatchObject({ name: ' Болт\t M8 ', unit: 'кг', invoiceName: 'Поставщик A' });
    expect(h.materials.updateOne).toHaveBeenCalledWith(expect.anything(), expect.anything(), { session: h.session });
  });

  it('чужой существующий Material → 403 без перекатегоризации', async () => {
    const own = new Types.ObjectId();
    const existing = doc('Болт', { categoryId: new Types.ObjectId() });
    const h = make([existing]);
    const categoryId = existing.categoryId;
    await expect(h.service.createItem({ name: 'болт', categoryId: String(own) }, scopeOfZones([{ id: 'own', categoryIds: [String(own)] }]))).rejects.toBeInstanceOf(ForbiddenException);
    expect(existing.categoryId).toBe(categoryId);
    expect(h.materials.updateOne).not.toHaveBeenCalled();
    expect(h.materials.create).not.toHaveBeenCalled();
  });

  it('scope повторно проверяется в транзакции, даже если preliminary нашёл свою позицию', async () => {
    const own = new Types.ObjectId();
    const existing = doc('Болт', { categoryId: own });
    const h = make([existing]);
    h.names.acquire.mockImplementationOnce(async () => { existing.categoryId = new Types.ObjectId(); });
    await expect(h.service.createItem({ name: 'болт', categoryId: String(own) }, scopeOfZones([{ id: 'own', categoryIds: [String(own)] }]))).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.materials.updateOne).not.toHaveBeenCalled();
  });

  it('чужая входящая категория → 403; разрешённая категория сохраняется', async () => {
    const own = new Types.ObjectId();
    const h = make();
    const scope = scopeOfZones([{ id: 'own', categoryIds: [String(own)] }]);
    await expect(h.service.createItem({ name: 'Болт', categoryId: String(new Types.ObjectId()) }, scope)).rejects.toBeInstanceOf(ForbiddenException);
    await h.service.createItem({ name: 'Болт', categoryId: String(own) }, scope);
    expect(String(h.docs[0].categoryId)).toBe(String(own));
  });

  it('post-commit сбой остатка: повтор чинит его без второго Material/сброса количества', async () => {
    const h = make();
    h.storage.updateOne.mockImplementationOnce(() => ({ exec: async () => { throw new Error('storage unavailable'); } }) as never);
    await expect(h.service.createItem({ name: 'Болт', article: 'A' })).rejects.toThrow('storage unavailable');
    expect(h.docs).toHaveLength(1);
    const id = String(h.docs[0]._id);
    await expect(h.service.createItem({ name: 'БОЛТ', article: 'A' })).resolves.toEqual({ id });
    expect(h.materials.create).toHaveBeenCalledTimes(1);
    expect(h.storage.updateOne.mock.calls[1][1]).toMatchObject({ $setOnInsert: { quantity: 0, reservedQty: 0 } });
    expect((h.storage.updateOne.mock.calls[1][1] as { $set?: object }).$set ?? {}).not.toHaveProperty('quantity');
  });

  it('QR сбой не отменяет созданную позицию', async () => {
    const h = make();
    h.qr.ensureCode.mockRejectedValueOnce(new Error('QR unavailable'));
    await expect(h.service.createItem({ name: 'Болт', article: 'A' })).resolves.toHaveProperty('id');
    expect(h.docs).toHaveLength(1);
  });

  it('rename берёт оба имени и проверяет конфликт в той же session', async () => {
    const a = doc('Болт');
    const h = make([a, doc('Гайка')]);
    await expect(h.service.updateItem(String(a._id), { name: ' ГАЙКА ' })).rejects.toBeInstanceOf(ConflictException);
    expect(h.names.acquire).toHaveBeenCalledWith(['Болт', 'ГАЙКА'], h.session);
    expect(a.name).toBe('Болт');
    await h.service.updateItem(String(a._id), { name: 'Винт' });
    expect(a.name).toBe('Винт');
  });

  it('restore берёт ключ имени; активный дубль запрещён, свободное имя восстанавливает тот же id', async () => {
    const tombstone = doc('Болт', { deletedAt: new Date() });
    const h = make([tombstone, doc('БОЛТ')]);
    await expect(h.service.restoreItem(String(tombstone._id))).rejects.toBeInstanceOf(ConflictException);
    expect(h.names.acquire).toHaveBeenCalledWith(['Болт'], h.session);
    expect(tombstone.deletedAt).toBeInstanceOf(Date);
    h.docs.pop();
    await expect(h.service.restoreItem(String(tombstone._id))).resolves.toEqual({ id: String(tombstone._id) });
    expect(tombstone.deletedAt).toBeNull();
    expect(h.materials.updateOne).toHaveBeenCalledWith(expect.anything(), { $set: { deletedAt: null } }, { session: h.session });
    expect(h.materials.create).not.toHaveBeenCalled();
  });
});
