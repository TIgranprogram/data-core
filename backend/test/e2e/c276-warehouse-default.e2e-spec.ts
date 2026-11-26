import { createConnection, Types, type ClientSession, type Connection } from 'mongoose';
import request from 'supertest';
import { StorageItem, StorageItemSchema, type StorageItemDocument } from '../../src/modules/stock/schemas/storage-item.schema';
import { Warehouse, WarehouseSchema, type WarehouseDocument } from '../../src/modules/stock/schemas/warehouse.schema';
import { StockCoreService } from '../../src/modules/stock/stock-core.service';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { createTestApp, type TestContext } from '../setup/test-db';

function latch() {
  let open!: () => void;
  const ready = new Promise<void>(resolve => { open = resolve; });
  return { ready, open };
}

describe('C276 — единственный склад по умолчанию в Mongo', () => {
  let ctx: TestContext;
  let secondConnection: Connection;
  let first: StockCoreService;
  let second: StockCoreService;
  let admin: string;
  const warehouseModel = () => ctx.connection.model<WarehouseDocument>(Warehouse.name);
  const warehouses = () => ctx.connection.db!.collection('warehouses');
  const guards = () => ctx.connection.db!.collection<{ _id: string; revision: number }>('stock_warehouse_guards');
  const makeService = (connection: Connection) => new StockCoreService(
    connection, connection.model<WarehouseDocument>(Warehouse.name), connection.model<StorageItemDocument>(StorageItem.name),
    { isEnabled: async () => true } as never,
  );
  const liveDefaults = () => warehouses().find({ deletedAt: null, isDefault: true }).toArray();

  async function writeFixture(work: (session: ClientSession) => Promise<unknown>) {
    const session = await ctx.connection.startSession();
    try {
      await session.withTransaction(async () => {
        // Связать изменения фикстуры с guard: старый snapshot иначе может увидеть уже удалённые строки.
        const guard = await guards().updateOne({ _id: 'default' }, { $inc: { revision: 1 } }, { session });
        expect(guard.matchedCount).toBe(1);
        await work(session);
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally {
      await session.endSession();
    }
  }

  beforeAll(async () => {
    const name = process.env.MONGO_DB_TEST ?? 'datacore-test';
    const uri = new URL(process.env.MONGO_URI ?? 'mongodb://localhost:27017/datacore');
    if (!/^datacore-test(?:-[a-z0-9-]+)?$/.test(name) || !['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname)) {
      throw new Error('C276: нужна одноразовая локальная БД datacore-test*');
    }
    ctx = await createTestApp({ strictValidation: true });
    admin = (await loginAsAdmin(ctx.app)).access;
    secondConnection = await createConnection(process.env.MONGO_URI!, { monitorCommands: true, autoIndex: false, autoCreate: false }).asPromise();
    secondConnection.model(Warehouse.name, WarehouseSchema.clone());
    secondConnection.model(StorageItem.name, StorageItemSchema.clone());
    first = makeService(ctx.connection);
    second = makeService(secondConnection);
    await guards().deleteOne({ _id: 'default' });
    await Promise.all([first.onModuleInit(), second.onModuleInit()]);
    expect(await guards().countDocuments({ _id: 'default' })).toBe(1);
  });

  beforeEach(async () => {
    await writeFixture(session => warehouses().deleteMany({}, { session }));
    expect(await warehouses().countDocuments({})).toBe(0);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await secondConnection?.close();
    await ctx?.cleanup();
  });

  it('параллельное первое создание в двух подключениях оставляет ровно один default', async () => {
    const entered = latch();
    const attempted = latch();
    const release = latch();
    const model = warehouseModel();
    const originalCreate = model.create.bind(model);
    jest.spyOn(model, 'create').mockImplementationOnce((async (...args: unknown[]) => {
      entered.open();
      await release.ready;
      return Reflect.apply(originalCreate, model, args);
    }) as typeof model.create);
    const client = secondConnection.getClient();
    const onCommand = (event: { commandName: string; command: Record<string, unknown> }) => {
      if (event.commandName === 'update' && event.command.update === 'stock_warehouse_guards') attempted.open();
    };
    client.on('commandStarted', onCommand);
    const pending = [first.createWarehouse({ name: 'Север' })];
    try {
      await Promise.race([entered.ready, pending[0].then(() => { throw new Error('Первая вставка не остановилась в транзакции'); })]);
      pending.push(second.createWarehouse({ name: 'Юг' }));
      await Promise.race([attempted.ready, pending[1].then(() => { throw new Error('Вторая транзакция пропустила общую блокировку'); })]);
    } finally {
      release.open();
      client.off('commandStarted', onCommand);
      await Promise.allSettled(pending);
    }
    await Promise.all(pending);
    expect(await warehouses().countDocuments({ deletedAt: null })).toBe(2);
    expect((await liveDefaults()).map(row => row.name)).toEqual(['Север']);
  });

  it('параллельное явное назначение оставляет одно действующее назначение', async () => {
    await first.createWarehouse({ name: 'Прежний' });
    const [a, b] = await Promise.all([first.createWarehouse({ name: 'А' }), second.createWarehouse({ name: 'Б' })]) as { _id: Types.ObjectId }[];
    await Promise.all([first.patchWarehouse(String(a._id), { isDefault: true }), second.patchWarehouse(String(b._id), { isDefault: true })]);
    const defaults = await liveDefaults();
    expect(defaults).toHaveLength(1);
    expect([String(a._id), String(b._id)]).toContain(String(defaults[0]._id));
    expect(defaults[0].isActive).toBe(true);
  });

  it('два обычных POST назначают только первый склад, явное назначение переключает default', async () => {
    const post = (name: string, isDefault?: boolean) => request(ctx.app.getHttpServer()).post('/api/stock/warehouses')
      .set(authHeader(admin)).send({ name, ...(isDefault === undefined ? {} : { isDefault }) }).expect(201);
    const first = (await post('Первый обычный')).body;
    expect(first).toMatchObject({ isActive: true, isDefault: true });
    expect((await liveDefaults()).map(row => row.name)).toEqual(['Первый обычный']);
    const second = (await post('Второй обычный')).body;
    expect(second).toMatchObject({ isActive: true, isDefault: false });
    expect((await liveDefaults()).map(row => row.name)).toEqual(['Первый обычный']);
    const assigned = (await post('Явно назначенный', true)).body;
    expect(assigned).toMatchObject({ isActive: true, isDefault: true });
    expect((await liveDefaults()).map(row => row.name)).toEqual(['Явно назначенный']);
  });

  it('деактивация и архив переключают default, новый склад появляется только при чтении', async () => {
    const a = await first.createWarehouse({ name: 'Первый' }) as WarehouseDocument;
    expect(a.isDefault).toBe(true);
    expect((await liveDefaults()).map(row => row.name)).toEqual(['Первый']);
    const b = await first.createWarehouse({ name: 'Следующий' }) as WarehouseDocument;
    expect(b.isDefault).toBe(false);
    expect((await liveDefaults()).map(row => row.name)).toEqual(['Первый']);
    await expect(first.patchWarehouse(String(a._id), { isDefault: false })).rejects.toMatchObject({ status: 409 });
    await first.patchWarehouse(String(a._id), { isActive: false });
    expect((await liveDefaults()).map(row => String(row._id))).toEqual([String(b._id)]);
    expect(await warehouses().findOne({ _id: a._id })).toMatchObject({ isActive: false, isDefault: false });
    await expect(first.patchWarehouse(String(a._id), { isDefault: true })).rejects.toMatchObject({ status: 409 });
    await first.removeWarehouse(String(b._id));
    expect(await warehouses().countDocuments({})).toBe(2);
    expect(await liveDefaults()).toHaveLength(0);
    const [x, y] = await Promise.all([first.defaultWarehouse(), second.defaultWarehouse()]);
    expect(String(x._id)).toBe(String(y._id));
    expect(x.name).toBe('Главный склад');
    expect(await liveDefaults()).toHaveLength(1);
  });

  it('штатное чтение устраняет наследованные дубли и сохраняет чужой архив', async () => {
    const a = new Types.ObjectId(), b = new Types.ObjectId(), inactive = new Types.ObjectId(), archive = new Types.ObjectId();
    const earliest = new Date('2026-10-01T00:00:00Z'), latest = new Date('2026-10-02T00:00:00Z');
    await writeFixture(session => warehouses().insertMany([
      { _id: a, name: 'Без признака активности', isDefault: true, createdAt: earliest },
      { _id: b, name: 'Другой активный', isDefault: true, isActive: true, deletedAt: null, createdAt: latest },
      { _id: inactive, name: 'Неактивный', isDefault: true, isActive: false, deletedAt: null },
      { _id: archive, name: 'Исторический архив', isDefault: true, deletedAt: earliest },
    ], { session }));
    expect(String((await first.defaultWarehouse())._id)).toBe(String(a));
    expect((await liveDefaults()).map(row => String(row._id))).toEqual([String(a)]);
    expect(await warehouses().findOne({ _id: archive })).toMatchObject({ deletedAt: earliest, isDefault: true });
  });

  it('штатное чтение снимает старый флаг с неактивного склада при одном активном назначении', async () => {
    const active = new Types.ObjectId(), inactive = new Types.ObjectId();
    await writeFixture(session => warehouses().insertMany([
      { _id: active, name: 'Активный', isDefault: true, isActive: true, deletedAt: null },
      { _id: inactive, name: 'Неактивный', isDefault: true, isActive: false, deletedAt: null },
    ], { session }));
    expect(String((await first.defaultWarehouse())._id)).toBe(String(active));
    expect((await liveDefaults()).map(row => String(row._id))).toEqual([String(active)]);
    expect(await warehouses().findOne({ _id: inactive })).toMatchObject({ isActive: false, isDefault: false });
  });

  it('сбой вставки или назначения откатывает предыдущее снятие default', async () => {
    const a = await first.createWarehouse({ name: 'Действующий' }) as WarehouseDocument;
    expect(a.isDefault).toBe(true);
    expect((await liveDefaults()).map(row => row.name)).toEqual(['Действующий']);
    const b = await first.createWarehouse({ name: 'Запасной' }) as WarehouseDocument;
    expect(b.isDefault).toBe(false);
    expect((await liveDefaults()).map(row => row.name)).toEqual(['Действующий']);
    const create = jest.spyOn(warehouseModel(), 'create').mockRejectedValueOnce(new Error('Сбой вставки склада'));
    await expect(first.createWarehouse({ name: 'Несохранённый', isDefault: true })).rejects.toThrow('Сбой вставки склада');
    create.mockRestore();
    expect(await warehouses().countDocuments({})).toBe(2);
    expect((await liveDefaults()).map(row => String(row._id))).toEqual([String(a._id)]);
    const assignment = { session: () => assignment, exec: async () => { throw new Error('Сбой назначения'); } };
    const update = jest.spyOn(warehouseModel(), 'updateOne').mockReturnValueOnce(assignment as never);
    await expect(first.patchWarehouse(String(b._id), { isDefault: true })).rejects.toThrow('Сбой назначения');
    update.mockRestore();
    expect((await liveDefaults()).map(row => String(row._id))).toEqual([String(a._id)]);
  });

  it('fallback остаётся в переданной внешней транзакции', async () => {
    const transaction = await ctx.connection.startSession();
    const abort = new Error('Вызывающий отменил внешнюю транзакцию');
    try {
      await expect(transaction.withTransaction(async () => {
        const fallback = await first.defaultWarehouse(transaction);
        expect(transaction.inTransaction()).toBe(true);
        expect(await warehouses().findOne({ _id: fallback._id }, { session: transaction })).toMatchObject({ isDefault: true });
        throw abort;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } })).rejects.toBe(abort);
      expect(await warehouses().countDocuments({})).toBe(0);
    } finally {
      await transaction.endSession();
    }
  });

  it('при выключенном C260 ручная запись даёт 409, штатное чтение работает', async () => {
    const defaultId = String((await first.defaultWarehouse())._id);
    const http = () => request(ctx.app.getHttpServer());
    const flags = '/api/feature-flags/c260.warehouses.api';
    try {
      await http().put(flags).set(authHeader(admin)).send({ enabledByDefault: false }).expect(200);
      await http().post('/api/stock/warehouses').set(authHeader(admin)).send({ name: 'Закрыто' }).expect(409);
      await http().patch(`/api/stock/warehouses/${defaultId}`).set(authHeader(admin)).send({ name: 'Закрыто' }).expect(409);
      await http().delete(`/api/stock/warehouses/${defaultId}`).set(authHeader(admin)).expect(409);
      expect((await http().get('/api/stock/warehouses').set(authHeader(admin)).expect(200)).body.defaultId).toBe(defaultId);
    } finally {
      await http().put(flags).set(authHeader(admin)).send({ enabledByDefault: true }).expect(200);
    }
  });
});
