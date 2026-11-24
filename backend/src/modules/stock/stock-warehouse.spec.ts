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
  const warehouses = {
    findOne: reads(findValues),
    updateOne: jest.fn((filter: unknown, update: unknown) => {
      updates.push({ op: 'updateOne', filter, update });
      const chain = { session: () => chain, exec: async () => ({}) };
      return chain;
    }),
    updateMany: jest.fn((filter: unknown, update: unknown) => {
      updates.push({ op: 'updateMany', filter, update });
      return { exec: async () => ({}) };
    }),
    create: jest.fn(async (value: unknown) => {
      created.push(value);
      return { _id: new Types.ObjectId(), ...(value as object) };
    }),
  };
  return { warehouses, updates, created };
}

describe('C260 — запись склада', () => {
  it('в $set попадают только известные поля', () => {
    expect(warehouseSet({ name: 'Цех', quantity: 3, editedInApp: true, deletedAt: new Date() })).toEqual({ name: 'Цех' });
  });

  it('правка отвергает чужое поле и не вызывает replace', () => {
    const updateOne = jest.fn();
    const replaceOne = jest.fn();
    expect(() => patchWarehouse({ updateOne, replaceOne } as never, 'id', { name: 'Цех', editedInApp: true })).toThrow('не пишем');
    expect(updateOne).not.toHaveBeenCalled();
    expect(replaceOne).not.toHaveBeenCalled();
  });

  it('снятие пишет deletedAt и снимает isDefault', () => {
    const at = new Date('2026-11-24T00:00:00Z');
    const updateOne = jest.fn(() => ({ exec: async () => ({}) }));
    archiveWarehouse({ updateOne } as never, 'id', at);
    expect(updateOne).toHaveBeenCalledWith({ _id: 'id' }, { $set: { deletedAt: at, isDefault: false } });
  });

  it('вставка нового склада отбрасывает чужие ключи', async () => {
    const create = jest.fn(async (doc: unknown) => doc);
    await insertWarehouse({ create } as never, { name: 'А', stockQty: 5 });
    expect(create).toHaveBeenCalledWith({ name: 'А' });
  });

  it('флаг выключен — 409 и записи нет', async () => {
    const flags = { isEnabled: jest.fn(async () => false) };
    const { warehouses, created, updates } = writer([]);
    const core = new StockCoreService({} as never, warehouses as never, {} as never, flags as never);
    await expect(core.createWarehouse({ name: 'Цех' })).rejects.toMatchObject({ status: 409 });
    expect(flags.isEnabled).toHaveBeenCalledWith(WAREHOUSE_API_FLAG);
    expect(created).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('первый склад становится единственным по умолчанию', async () => {
    const flags = { isEnabled: jest.fn(async () => true) };
    const { warehouses, created, updates } = writer([null]);
    const core = new StockCoreService({} as never, warehouses as never, {} as never, flags as never);
    await core.createWarehouse({ name: '  Цех  ', type: 'production', isDefault: false });
    expect(created[0]).toMatchObject({ name: 'Цех', type: 'production', isActive: true, isDefault: true });
    expect(updates.some((row) => row.op === 'updateMany' && row.update && (row.update as { $set: unknown }).$set)).toBe(true);
    expect(JSON.stringify(created[0])).not.toContain('stockQty');
  });

  it('второй склад не забирает умолчание, пока его не назначили', async () => {
    const flags = { isEnabled: async () => true };
    const { warehouses, created, updates } = writer([{ _id: new Types.ObjectId() }]);
    const core = new StockCoreService({} as never, warehouses as never, {} as never, flags as never);
    await core.createWarehouse({ name: 'Филиал' });
    expect(created[0]).toMatchObject({ name: 'Филиал', isDefault: false });
    expect(updates.filter((row) => row.op === 'updateMany')).toHaveLength(0);
  });

  it('назначение по умолчанию снимает флаг с остальных и пишет $set', async () => {
    const flags = { isEnabled: async () => true };
    const id = new Types.ObjectId();
    const { warehouses, updates } = writer([{ _id: id, isDefault: false, name: 'Филиал' }, { _id: id, isDefault: true, name: 'Филиал' }]);
    const core = new StockCoreService({} as never, warehouses as never, {} as never, flags as never);
    await core.patchWarehouse(String(id), { isDefault: true, address: 'д. 1' });
    const many = updates.find((row) => row.op === 'updateMany');
    const one = updates.find((row) => row.op === 'updateOne');
    expect(many?.update).toEqual({ $set: { isDefault: false } });
    expect(one?.update).toEqual({ $set: { isDefault: true, address: 'д. 1' } });
  });

  it('единственный склад по умолчанию нельзя снять правкой', async () => {
    const flags = { isEnabled: async () => true };
    const id = new Types.ObjectId();
    const { warehouses, updates } = writer([{ _id: id, isDefault: true }]);
    const core = new StockCoreService({} as never, warehouses as never, {} as never, flags as never);
    await expect(core.patchWarehouse(String(id), { isDefault: false })).rejects.toMatchObject({ status: 409 });
    expect(updates).toHaveLength(0);
  });

  it('пустая правка — 400', async () => {
    const flags = { isEnabled: async () => true };
    const id = new Types.ObjectId();
    const { warehouses } = writer([{ _id: id, isDefault: false }]);
    const core = new StockCoreService({} as never, warehouses as never, {} as never, flags as never);
    await expect(core.patchWarehouse(String(id), {})).rejects.toMatchObject({ status: 400 });
  });

  it('снятие склада по умолчанию назначает другой действующий', async () => {
    const flags = { isEnabled: async () => true };
    const id = new Types.ObjectId();
    const next = new Types.ObjectId();
    const { warehouses, updates } = writer([
      { _id: id, isDefault: true },
      { _id: next, isDefault: false },
      { _id: id, isDefault: false, deletedAt: new Date() },
    ]);
    const core = new StockCoreService({} as never, warehouses as never, {} as never, flags as never);
    await core.removeWarehouse(String(id));
    expect(updates[0].update).toMatchObject({ $set: { isDefault: false } });
    expect((updates[0].update as { $set: { deletedAt?: Date } }).$set.deletedAt).toBeInstanceOf(Date);
    expect(updates[1].update).toEqual({ $set: { isDefault: true } });
    expect(updates[1].filter).toEqual({ _id: next });
  });

  it('defaultWarehouse не спрашивает флаг', async () => {
    const flags = { isEnabled: jest.fn(async () => { throw new Error('флаг'); }) };
    const doc = { _id: new Types.ObjectId(), isDefault: true };
    const warehouses = { findOne: reads([doc]), updateOne: jest.fn(), create: jest.fn() };
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
