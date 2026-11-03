import { ConflictException, ForbiddenException } from '@nestjs/common';
import { createConnection, Types, type Connection } from 'mongoose';
import { scopeOfZones } from '../../src/common/stock-scope';
import { CounterService } from '../../src/modules/counter/counter.service';
import { Material, MaterialSchema, type MaterialDocument } from '../../src/modules/material/material.schema';
import { MaterialPrice, MaterialPriceSchema, type MaterialPriceDocument } from '../../src/modules/material/material-price.schema';
import { MaterialPriceService } from '../../src/modules/material/material-price.service';
import { StorageItem, StorageItemSchema, type StorageItemDocument } from '../../src/modules/stock/schemas/storage-item.schema';
import { StockCatalogName, StockCatalogNameSchema, type StockCatalogNameDocument } from '../../src/modules/stock/stock-catalog-name.schema';
import { StockCatalogNameService } from '../../src/modules/stock/stock-catalog-name.service';
import { StockCatalogService } from '../../src/modules/stock/stock-catalog.service';
import type { StockCoreService } from '../../src/modules/stock/stock-core.service';
import type { StockSearchService } from '../../src/modules/stock/stock-search.service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Отдельный opt-in, без AppModule, .env и test-db.ts; запуск только координатором на disposable rs0. */
describe('T26: Mongo atomicity каталога', () => {
  let firstConnection: Connection;
  let secondConnection: Connection;
  const warehouseId = new Types.ObjectId();
  const schemaModels = (connection: Connection) => ({
    materials: connection.model<MaterialDocument>(Material.name, MaterialSchema.clone()),
    storage: connection.model<StorageItemDocument>(StorageItem.name, StorageItemSchema.clone()),
    names: connection.model<StockCatalogNameDocument>(StockCatalogName.name, StockCatalogNameSchema.clone()),
    prices: connection.model<MaterialPriceDocument>(MaterialPrice.name, MaterialPriceSchema.clone()),
  });
  let firstModels: ReturnType<typeof schemaModels>;
  let secondModels: ReturnType<typeof schemaModels>;

  const make = (connection: Connection, models: ReturnType<typeof schemaModels>) => {
    const names = new StockCatalogNameService(connection, models.names);
    const core = {
      defaultWarehouse: async () => ({ _id: warehouseId }),
      markEdited: async (_id: Types.ObjectId) => { await connection.db!.collection('materials').updateOne({ _id }, { $set: { editedInApp: true } }); },
      setWeightG: async () => undefined,
    } as unknown as StockCoreService;
    const search = { getItem: async (id: string) => {
      const mat = await models.materials.findById(id).lean().exec();
      if (!mat) throw new Error('Material не найден после commit');
      return { ...mat, id: String(mat._id) };
    } } as unknown as StockSearchService;
    return { names, catalog: new StockCatalogService(connection, models.storage, models.materials, new CounterService(connection), core, search, names) };
  };

  beforeAll(async () => {
    const uri = process.env.STOCK_CATALOG_TEST_URI;
    if (process.env.STOCK_CATALOG_TEST_DISPOSABLE !== '1' || !uri) throw new Error('T26 требует явно выданный disposable URI и STOCK_CATALOG_TEST_DISPOSABLE=1');
    const parsed = new URL(uri);
    if (parsed.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || !/^\/datacore-test-t26-[a-z0-9-]+$/.test(parsed.pathname)) {
      throw new Error('T26 разрешён только на локальной disposable БД datacore-test-t26-<уникальный suffix>');
    }
    firstConnection = await createConnection(uri, { monitorCommands: true }).asPromise();
    secondConnection = await createConnection(uri, { monitorCommands: true }).asPromise();
    firstModels = schemaModels(firstConnection);
    secondModels = schemaModels(secondConnection);
    // Не предполагаем, что транзакция Mongo 4.4 может создать новую коллекцию.
    for (const model of Object.values(firstModels)) await model.createCollection();
    await firstConnection.db!.createCollection('counters');
    await firstConnection.db!.createCollection('categories');
    await Promise.all([firstModels.storage.init(), firstModels.materials.init(), firstModels.prices.init()]);
    await make(firstConnection, firstModels).names.onModuleInit();
    await make(secondConnection, secondModels).names.onModuleInit();
  });

  beforeEach(async () => {
    if (!firstConnection) return;
    // Только явная disposable БД, без dropDatabase/общего harness.
    for (const model of Object.values(firstModels)) await model.collection.deleteMany({});
    await firstConnection.db!.collection('counters').deleteMany({});
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await secondConnection?.close();
    await firstConnection?.close();
  });

  async function race(options: { abortFirst?: boolean; renameId?: string; restoreId?: string } = {}) {
    const first = make(firstConnection, firstModels);
    const second = make(secondConnection, secondModels);
    const arrived = deferred();
    const locked = deferred();
    const attempted = deferred();
    const release = deferred();
    let arrivals = 0;
    const enter = async () => { if (++arrivals === 2) arrived.resolve(); await arrived.promise; };
    const acquireFirst = first.names.acquire.bind(first.names);
    const acquireSecond = second.names.acquire.bind(second.names);
    let firstEntry = true;
    let secondEntry = true;
    // run([]) для rename: gate именно на непустом наборе ключей.
    jest.spyOn(first.names, 'acquire').mockImplementation(async (keys, session) => {
      if (!keys.length) return acquireFirst(keys, session);
      if (!firstEntry) return acquireFirst(keys, session);
      firstEntry = false;
      await enter();
      await acquireFirst(keys, session);
      locked.resolve();
      await release.promise;
      if (options.abortFirst) throw new Error('Управляемый abort первого запроса');
    });
    jest.spyOn(second.names, 'acquire').mockImplementation(async (keys, session) => {
      if (!secondEntry) return acquireSecond(keys, session);
      secondEntry = false;
      await enter();
      await locked.promise;
      return acquireSecond(keys, session);
    });
    // Сигнал не до вызова: драйвер действительно начал вторую команду findAndModify.
    const client = secondConnection.getClient();
    const observe = (event: { commandName: string; command: Record<string, unknown> }) => {
      if (event.commandName === 'findAndModify' && event.command.findAndModify === 'stock_catalog_name_reservations') attempted.resolve();
    };
    client.on('commandStarted', observe);
    const a = options.renameId
      ? first.catalog.updateItem(options.renameId, { name: 'Болт M8' })
      : options.restoreId ? first.catalog.restoreItem(options.restoreId)
      : first.catalog.createItem({ name: ' Болт\t  M8 ', article: 'A8' });
    const b = second.catalog.createItem({ name: 'болт  m8', article: 'A8' });
    // Подписываемся на reject сразу, чтобы управляемый abort не стал unhandled rejection.
    const settled = Promise.allSettled([a, b]);
    try {
      await attempted.promise;
      release.resolve();
      return await settled;
    } finally {
      release.resolve();
      client.off('commandStarted', observe);
    }
  }

  it.each([false, true])('два create: новая/существующая резервация (%s), один Material и один остаток', async (seedReservation) => {
    if (seedReservation) await firstModels.names.create({ _id: 'болт m8', revision: 10 });
    const results = await race();
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const ids = results.map((r) => r.status === 'fulfilled' ? (r.value as { id: string }).id : '');
    expect(new Set(ids).size).toBe(1);
    expect(await firstModels.materials.countDocuments({})).toBe(1);
    expect(await firstModels.storage.countDocuments({})).toBe(1);
    const reservation = await firstModels.names.findById('болт m8').lean().exec();
    expect(reservation?.revision).toBe(seedReservation ? 12 : 2);
  });

  it('abort первого: второй создаёт один Material; повтор первого переиспользует id', async () => {
    const results = await race({ abortFirst: true });
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');
    const retry = await make(firstConnection, firstModels).catalog.createItem({ name: 'БОЛТ M8', article: 'A8' });
    expect(retry.id).toBe(results[1].status === 'fulfilled' ? (results[1].value as { id: string }).id : '');
    expect(await firstModels.materials.countDocuments({})).toBe(1);
  });

  it('rename/create разделяют ключ нового имени; конфликт rename не делает дубль', async () => {
    const existing = await firstModels.materials.create({ name: 'Винт', article: 'A8', unit: 'шт' });
    const results = await race({ renameId: String(existing._id) });
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await firstModels.materials.countDocuments({})).toBe(1);
    const catalog = make(firstConnection, firstModels).catalog;
    await catalog.createItem({ name: 'Гайка', article: 'G8' });
    await expect(catalog.updateItem(String(existing._id), { name: 'ГАЙКА' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('restore/create: одно активное имя, тот же восстановленный Material', async () => {
    const existing = await firstModels.materials.create({ name: 'Болт M8', article: 'A8', unit: 'шт', deletedAt: new Date() });
    const results = await race({ restoreId: String(existing._id) });
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await firstModels.materials.countDocuments({ deletedAt: null })).toBe(1);
    expect(await firstModels.materials.countDocuments({})).toBe(1);
  });

  it.each([['Straße', 'STRAẞE'], ['Σ', 'ς'], ['ſ', 'S'], ['K', 'K']])('caseless %s/%s использует один Material', async (left, right) => {
    const catalog = make(firstConnection, firstModels).catalog;
    const first = await catalog.createItem({ name: left, article: 'A' });
    const second = await catalog.createItem({ name: right, article: 'A' });
    expect(first.id).toBe(second.id);
    expect(await firstModels.materials.countDocuments({})).toBe(1);
    expect(await firstModels.names.countDocuments({})).toBe(1);
  });

  it('чужой scope не перекатегоризирует дубль; разрешённая категория остаётся', async () => {
    const own = new Types.ObjectId();
    const foreign = new Types.ObjectId();
    const catalog = make(firstConnection, firstModels).catalog;
    const item = await catalog.createItem({ name: 'Болт', article: 'A', categoryId: String(foreign) });
    await expect(catalog.createItem({ name: 'БОЛТ', categoryId: String(own) }, scopeOfZones([{ id: 'own', categoryIds: [String(own)] }]))).rejects.toBeInstanceOf(ForbiddenException);
    expect(String((await firstModels.materials.findById(item.id).lean().exec())?.categoryId)).toBe(String(foreign));
  });

  it('post-commit сбой: повтор создаёт только недостающий остаток, не новый Material', async () => {
    const first = make(firstConnection, firstModels);
    jest.spyOn(firstModels.storage, 'updateOne').mockImplementationOnce(() => ({ exec: async () => { throw new Error('Управляемый post-commit сбой'); } }) as never);
    await expect(first.catalog.createItem({ name: 'Болт', article: 'A' })).rejects.toThrow('post-commit');
    expect(await firstModels.materials.countDocuments({})).toBe(1);
    expect(await firstModels.storage.countDocuments({})).toBe(0);
    const retry = await make(secondConnection, secondModels).catalog.createItem({ name: 'БОЛТ', article: 'A' });
    expect(await firstModels.storage.countDocuments({ materialId: new Types.ObjectId(retry.id) })).toBe(1);
    expect(await firstModels.materials.countDocuments({})).toBe(1);
  });

  it('разные имена не склеиваются, закупки одного Material остаются двумя фактами', async () => {
    const a = make(firstConnection, firstModels).catalog;
    const b = make(secondConnection, secondModels).catalog;
    const [bolt, nut] = await Promise.all([a.createItem({ name: 'Болт', article: 'A' }), b.createItem({ name: 'Гайка', article: 'G' })]);
    expect(bolt.id).not.toBe(nut.id);
    const materialId = new Types.ObjectId(bolt.id);
    const prices = new MaterialPriceService(firstModels.prices, firstModels.materials);
    const invoices = [new Types.ObjectId(), new Types.ObjectId()];
    const requests = [new Types.ObjectId(), new Types.ObjectId()];
    const suppliers = [new Types.ObjectId(), new Types.ObjectId()];
    await prices.record({ materialId, requestId: requests[0], invoiceId: invoices[0], supplierId: suppliers[0], qty: 2, lineTotalWithVat: 120, date: new Date(), source: 'invoice_paid' });
    await a.createItem({ name: 'БОЛТ', article: 'A' });
    await prices.record({ materialId, requestId: requests[1], invoiceId: invoices[1], supplierId: suppliers[1], qty: 5, lineTotalWithVat: 600, date: new Date(), source: 'invoice_paid' });
    const rows = await firstModels.prices.find({ materialId }).sort({ qty: 1 }).lean().exec();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.qty)).toEqual([2, 5]);
    expect(rows.map((r) => String(r.supplierId))).toEqual(suppliers.map(String));
    expect(rows.map((r) => String(r.invoiceId))).toEqual(invoices.map(String));
    expect(rows.map((r) => r.priceWithVat)).toEqual([60, 120]);
    expect(await firstModels.materials.countDocuments({})).toBe(2);
  });
});
