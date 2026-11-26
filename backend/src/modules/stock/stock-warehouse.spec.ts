import 'reflect-metadata';
import { Types } from 'mongoose';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { StockController } from './stock.controller';
import { StockCoreService } from './stock-core.service';
import { archiveWarehouse, insertWarehouse, patchWarehouse, warehouseSet } from './stock-writes';
import { WAREHOUSE_API_FLAG } from './warehouse-flag';

function reads(values: unknown[]) {
  let i = 0;
  return jest.fn(() => {
    const row = values[i++];
    const chain = {
      select: () => chain,
      sort: () => chain,
      lean: () => chain,
      session: () => chain,
      exec: async () => row,
    };
    return chain;
  });
}

function writer(findValues: unknown[]) {
  const updates: { op: string; filter: unknown; update: unknown }[] = [];
  const created: unknown[] = [];
  const session = { withTransaction: jest.fn(async (run: () => Promise<unknown>) => run()), endSession: jest.fn() };
  const guard = { insertOne: jest.fn(), updateOne: jest.fn(async () => ({ matchedCount: 1 })) };
  const connection = { startSession: jest.fn(async () => session), db: { createCollection: jest.fn(), collection: () => guard } };
  const warehouses = {
    createCollection: jest.fn(),
    findOne: reads(findValues),
    updateOne: jest.fn((filter: unknown, update: unknown) => {
      updates.push({ op: 'updateOne', filter, update });
      const chain = { session: (supplied: unknown) => { expect(supplied).toBe(session); return chain; }, exec: async () => ({}) };
      return chain;
    }),
    updateMany: jest.fn((filter: unknown, update: unknown) => {
      updates.push({ op: 'updateMany', filter, update });
      const chain = { session: (supplied: unknown) => { expect(supplied).toBe(session); return chain; }, exec: async () => ({}) };
      return chain;
    }),
    create: jest.fn(async (values: object[], options: { session: unknown }) => {
      expect(options.session).toBe(session);
      created.push(...values);
      return values.map(value => ({ _id: new Types.ObjectId(), ...value }));
    }),
  };
  const makeCore = (flags: { isEnabled: () => Promise<boolean> }) => new StockCoreService(connection as never, warehouses as never, {} as never, flags as never);
  return { warehouses, updates, created, makeCore, guard, session };
}

describe('C260 — запись склада', () => {
  it('в $set попадают только известные поля', () => {
    expect(warehouseSet({ name: 'Цех', quantity: 3, editedInApp: true, deletedAt: new Date() })).toEqual({ name: 'Цех' });
  });

  it('правка отвергает чужое поле и не вызывает replace', () => {
    const updateOne = jest.fn();
    const replaceOne = jest.fn();
    expect(() => patchWarehouse({ updateOne, replaceOne } as never, 'id', { name: 'Цех', editedInApp: true }, {} as never)).toThrow('не пишем');
    expect(updateOne).not.toHaveBeenCalled();
    expect(replaceOne).not.toHaveBeenCalled();
  });

  it('снятие пишет deletedAt и снимает isDefault', async () => {
    const at = new Date('2026-11-24T00:00:00Z');
    const session = {};
    const useSession = jest.fn(() => ({ exec: async () => ({}) }));
    const updateOne = jest.fn(() => ({ session: useSession }));
    await archiveWarehouse({ updateOne } as never, 'id', at, session as never);
    expect(updateOne).toHaveBeenCalledWith({ _id: 'id', deletedAt: null }, { $set: { deletedAt: at, isDefault: false } });
    expect(useSession).toHaveBeenCalledWith(session);
  });

  it('вставка нового склада отбрасывает чужие ключи', async () => {
    const session = {};
    const create = jest.fn(async (docs: unknown[]) => docs);
    await insertWarehouse({ create } as never, { name: 'А', stockQty: 5 }, session as never);
    expect(create).toHaveBeenCalledWith([{ name: 'А' }], { session });
  });

  it('флаг выключен — 409 и записи нет', async () => {
    const flags = { isEnabled: jest.fn(async () => false) };
    const { created, updates, makeCore, guard } = writer([]);
    const core = makeCore(flags);
    await expect(core.createWarehouse({ name: 'Цех' })).rejects.toMatchObject({ status: 409 });
    await expect(core.patchWarehouse(String(new Types.ObjectId()), { name: 'Цех' })).rejects.toMatchObject({ status: 409 });
    await expect(core.removeWarehouse(String(new Types.ObjectId()))).rejects.toMatchObject({ status: 409 });
    expect(flags.isEnabled).toHaveBeenCalledWith(WAREHOUSE_API_FLAG);
    expect(created).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(guard.updateOne).not.toHaveBeenCalled();
  });

  it('первый склад становится единственным по умолчанию', async () => {
    const flags = { isEnabled: jest.fn(async () => true) };
    const { created, updates, makeCore, guard, session } = writer([null]);
    const core = makeCore(flags);
    await core.createWarehouse({ name: '  Цех  ', type: 'production', isDefault: false });
    expect(created[0]).toMatchObject({ name: 'Цех', type: 'production', isActive: true, isDefault: true });
    expect(updates.some((row) => row.op === 'updateMany' && row.update && (row.update as { $set: unknown }).$set)).toBe(true);
    expect(JSON.stringify(created[0])).not.toContain('stockQty');
    expect(guard.updateOne).toHaveBeenCalledWith({ _id: 'default' }, { $inc: { revision: 1 } }, { session });
    expect(session.withTransaction).toHaveBeenCalledWith(expect.any(Function), { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  });

  it('второй склад не забирает умолчание, пока его не назначили', async () => {
    const flags = { isEnabled: async () => true };
    const existing = { _id: new Types.ObjectId(), isDefault: true };
    const { created, updates, makeCore } = writer([existing, existing]);
    const core = makeCore(flags);
    await core.createWarehouse({ name: 'Филиал' });
    expect(created[0]).toMatchObject({ name: 'Филиал', isDefault: false });
    expect(updates).toEqual([{ op: 'updateMany', filter: { _id: { $ne: existing._id }, isDefault: true, deletedAt: null }, update: { $set: { isDefault: false } } }]);
  });

  it('назначение по умолчанию снимает флаг с остальных и пишет $set', async () => {
    const flags = { isEnabled: async () => true };
    const id = new Types.ObjectId();
    const { updates, makeCore } = writer([{ _id: id, isDefault: false, name: 'Филиал' }, { _id: id, isDefault: true, name: 'Филиал' }]);
    const core = makeCore(flags);
    await core.patchWarehouse(String(id), { isDefault: true, address: 'д. 1' });
    const many = updates.find((row) => row.op === 'updateMany');
    const one = updates.find((row) => row.op === 'updateOne');
    expect(many?.update).toEqual({ $set: { isDefault: false } });
    expect(one?.update).toEqual({ $set: { isDefault: true, address: 'д. 1' } });
  });

  it('единственный склад по умолчанию нельзя снять правкой', async () => {
    const flags = { isEnabled: async () => true };
    const id = new Types.ObjectId();
    const { updates, makeCore } = writer([{ _id: id, isDefault: true }]);
    const core = makeCore(flags);
    await expect(core.patchWarehouse(String(id), { isDefault: false })).rejects.toMatchObject({ status: 409 });
    expect(updates).toHaveLength(0);
  });

  it('пустая правка — 400', async () => {
    const flags = { isEnabled: async () => true };
    const id = new Types.ObjectId();
    const { makeCore } = writer([{ _id: id, isDefault: false }]);
    const core = makeCore(flags);
    await expect(core.patchWarehouse(String(id), {})).rejects.toMatchObject({ status: 400 });
  });

  it('снятие склада по умолчанию назначает другой действующий', async () => {
    const flags = { isEnabled: async () => true };
    const id = new Types.ObjectId();
    const next = new Types.ObjectId();
    const { updates, makeCore } = writer([
      { _id: id, isDefault: true },
      null,
      { _id: next, isDefault: false },
      { _id: id, isDefault: false, deletedAt: new Date() },
    ]);
    const core = makeCore(flags);
    await core.removeWarehouse(String(id));
    expect(updates[0].update).toMatchObject({ $set: { isDefault: false } });
    expect((updates[0].update as { $set: { deletedAt?: Date } }).$set.deletedAt).toBeInstanceOf(Date);
    expect(updates[2].update).toEqual({ $set: { isDefault: true } });
    expect(updates[2].filter).toEqual({ _id: next, deletedAt: null });
  });

  it('defaultWarehouse не спрашивает флаг', async () => {
    const flags = { isEnabled: jest.fn(async () => { throw new Error('флаг'); }) };
    const doc = { _id: new Types.ObjectId(), isDefault: true };
    const warehouses = { find: jest.fn(() => ({ limit: () => ({ exec: async () => [doc] }) })), updateOne: jest.fn(), create: jest.fn() };
    const core = new StockCoreService({} as never, warehouses as never, {} as never, flags as never);
    await expect(core.defaultWarehouse()).resolves.toBe(doc);
    expect(flags.isEnabled).not.toHaveBeenCalled();
    expect(warehouses.updateOne).not.toHaveBeenCalled();
  });
});

describe('C260 — маршруты склада', () => {
  it('запись: admin и manager, чтение шире', () => {
    expect(Reflect.getMetadata(ROLES_KEY, StockController.prototype.createWarehouse)).toEqual(['admin', 'manager']);
    expect(Reflect.getMetadata(ROLES_KEY, StockController.prototype.patchWarehouse)).toEqual(['admin', 'manager']);
    expect(Reflect.getMetadata(ROLES_KEY, StockController.prototype.removeWarehouse)).toEqual(['admin', 'manager']);
    expect(Reflect.getMetadata(ROLES_KEY, StockController.prototype.warehouses)).toEqual(['admin', 'director', 'manager', 'user']);
  });

  it('контроллер отдаёт тело фасаду', async () => {
    const stock = {
      createWarehouse: jest.fn(async () => ({ name: 'Цех' })),
      patchWarehouse: jest.fn(async () => ({ name: 'Цех' })),
      removeWarehouse: jest.fn(async () => ({ deletedAt: new Date() })),
    };
    const controller = new StockController(stock as never, {} as never);
    await controller.createWarehouse({ name: 'Цех' });
    await controller.patchWarehouse('id', { address: 'д. 1' });
    await controller.removeWarehouse('id');
    expect(stock.createWarehouse).toHaveBeenCalledWith({ name: 'Цех' });
    expect(stock.patchWarehouse).toHaveBeenCalledWith('id', { address: 'д. 1' });
    expect(stock.removeWarehouse).toHaveBeenCalledWith('id');
  });
});
