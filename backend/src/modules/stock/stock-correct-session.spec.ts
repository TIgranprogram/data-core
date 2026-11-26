import { Types } from 'mongoose';
import { StockMovementsService } from './stock-movements.service';
import { StockCoreService } from './stock-core.service';
import { prepareTarget } from './stock-target';

const flagsOn = { isEnabled: async () => true };

/** Внешнее чтение внутри незавершённой транзакции может ждать её же записи за queued DDL. */
function setup() {
  const materialId = new Types.ObjectId(), warehouseId = new Types.ObjectId(), movementId = new Types.ObjectId();
  let active = false;
  const session = { withTransaction: async (fn: () => Promise<void>) => { active = true; try { await fn(); } finally { active = false; } }, endSession: async () => undefined };
  const check = (name: string, supplied?: unknown) => { if (active && supplied !== session) throw new Error(`OUTSIDE_SESSION:${name}`); };
  const query = (name: string, value: unknown) => {
    let supplied: unknown;
    const chain = { session: (s: unknown) => { supplied = s; return chain; }, lean: () => chain, exec: async () => { check(name, supplied); return value; }, then: (yes: (v: unknown) => unknown, no?: (e: unknown) => unknown) => chain.exec().then(yes, no) };
    return chain;
  };
  const item = { quantity: 15, reservedQty: 0, save: jest.fn(async (options: { session: unknown }) => check('storage.save', options.session)) };
  const mv = { _id: movementId, type: 'out', materialId, qty: 5, delta: -5, date: new Date() };
  const updates = jest.fn(async (_f: unknown, _p: unknown, options: { session: unknown }) => { check('materials.update', options.session); return {}; });
  const connection = { startSession: async () => session, db: { collection: () => ({ updateOne: updates }) } };
  const movements = { exists: jest.fn(() => query('movements.exists', null)), findOne: jest.fn(() => query('movements.findOne', mv)), create: jest.fn(async () => []), updateOne: jest.fn((_f: unknown, _u: unknown, options: { session: unknown }) => ({ exec: async () => { check('movement.claim', options.session); return { matchedCount: 1 }; } })) };
  const reservations = { exists: jest.fn(() => query('reservations.exists', null)) };
  const materials = { exists: jest.fn(() => query('materials.exists', true)) };
  const core = { defaultWarehouse: jest.fn(async (s?: unknown) => { check('defaultWarehouse', s); return { _id: warehouseId }; }), loadStorage: jest.fn(async (_w: unknown, _m: unknown, s: unknown) => { check('loadStorage', s); return item; }), markEdited: jest.fn(async () => undefined) };
  const search = { getItem: jest.fn(async () => { check('response.getItem'); return { id: String(materialId), quantity: item.quantity }; }) };
  const svc = new StockMovementsService(connection as never, movements as never, reservations as never, materials as never, core as never, search as never, {} as never, flagsOn as never);
  return { svc, item, movementId, materialId, movements, materials, reservations, search, session, core };
}

describe('C242 — исправление списания в одной session', () => {
  it('обратное и новое движение выполняются без внешнего response/read до commit', async () => {
    const t = setup();
    const result = await t.svc.correctMovement(String(t.movementId), 3);
    expect(result).toMatchObject({ quantity: 17 });
    expect(t.item.quantity).toBe(17);
    expect(t.movements.create).toHaveBeenCalledTimes(2);
    expect(t.search.getItem).toHaveBeenCalledTimes(2); // начальная проверка и ответ после commit, не внутри.
    expect(t.core.loadStorage).toHaveBeenCalledTimes(2);
  });
  it('внешний владелец clientUid получает void, оба exists читают в его session и response не вызывается', async () => {
    const t = setup();
    const result = await t.session.withTransaction(async () => {
      expect(await t.svc.move(String(t.materialId), { type: 'in', qty: 2, clientUid: 'outer' }, undefined, undefined, t.session as never)).toBeUndefined();
    });
    expect(result).toBeUndefined();
    expect(t.movements.exists).toHaveBeenCalled();
    expect(t.reservations.exists).toHaveBeenCalled();
    expect(t.search.getItem).not.toHaveBeenCalled();
  });
  it('outer+byWeight явно отклоняется до I/O; standalone путь не ограничен этим guard', async () => {
    const t = setup();
    await expect(t.svc.move(String(t.materialId), { type: 'in', qty: 2, byWeight: {} as never }, undefined, undefined, t.session as never)).rejects.toMatchObject({ status: 400 });
    expect(t.materials.exists).not.toHaveBeenCalled();
    expect(t.core.defaultWarehouse).not.toHaveBeenCalled();
    expect(t.search.getItem).not.toHaveBeenCalled();
  });
});

describe('C242 — session в целевых preflight и fallback склада', () => {
  const session = { token: 'test-session' };
  it('prepareTarget читает позицию/заказ/сотрудника и причину в переданной session', async () => {
    const orderId = new Types.ObjectId(), lineId = new Types.ObjectId(), personId = new Types.ObjectId();
    const db = { collection: (name: string) => ({
      findOne: jest.fn(async (_filter: unknown, options: { session: unknown }) => { expect(options.session).toBe(session); return name === 'incomes' ? { _id: lineId, orderId } : { _id: name === 'salesorders' ? orderId : personId }; }),
      find: jest.fn((_filter: unknown, options: { session: unknown }) => { expect(options.session).toBe(session); return { toArray: async () => [{ name: 'Брак' }] }; }),
    }) };
    expect(await prepareTarget(db as never, { type: 'out', salesOrderLineId: String(lineId), personId: String(personId) }, session as never)).toMatchObject({ salesOrderId: orderId, salesOrderLineId: lineId, issuedToPersonId: personId });
    expect(await prepareTarget(db as never, { type: 'out', reason: 'Брак', writeOff: true }, session as never)).toMatchObject({ reason: 'Брак' });
  });
  it.each(['default', 'first', 'create'])('defaultWarehouse(%s) не теряет session в find/update/create', async (mode) => {
    const doc = { _id: new Types.ObjectId(), isDefault: mode !== 'first' };
    const transaction = { ...session, inTransaction: () => true, withTransaction: jest.fn(), endSession: jest.fn() };
    const query = (value: unknown) => {
      let supplied: unknown;
      const chain = { sort: () => chain, limit: () => chain, session: (s: unknown) => { supplied = s; return chain; }, exec: async () => { expect(supplied).toBe(transaction); return value; } };
      return chain;
    };
    const guard = { updateOne: jest.fn(async () => ({ matchedCount: 1 })) };
    const connection = { startSession: jest.fn(), db: { collection: () => guard } };
    const warehouses = {
      find: jest.fn(() => query(mode === 'default' ? [doc] : [])),
      findOne: jest.fn((filter: { isDefault?: boolean }) => query(mode === 'first' && !filter.isDefault ? doc : null)),
      updateMany: jest.fn(() => query({})),
      updateOne: jest.fn(() => query({})),
      create: jest.fn(async (_values: unknown[], options: { session: unknown }) => { expect(options.session).toBe(transaction); return [doc]; }),
    };
    const core = new StockCoreService(connection as never, warehouses as never, {} as never);
    expect(await core.defaultWarehouse(transaction as never)).toBe(doc);
    expect(connection.startSession).not.toHaveBeenCalled();
    expect(transaction.withTransaction).not.toHaveBeenCalled();
    expect(transaction.endSession).not.toHaveBeenCalled();
    if (mode === 'default') expect(guard.updateOne).not.toHaveBeenCalled();
    else expect(guard.updateOne).toHaveBeenCalledWith({ _id: 'default' }, { $inc: { revision: 1 } }, { session: transaction });
    expect(warehouses.updateOne).toHaveBeenCalledTimes(mode === 'first' ? 1 : 0);
    expect(warehouses.create).toHaveBeenCalledTimes(mode === 'create' ? 1 : 0);
  });
});
