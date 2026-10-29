import { ConflictException, BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Types } from 'mongoose';
import { SupplyInvoiceService } from './supply-invoice.service';

const chain = (result: unknown) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'skip', 'limit', 'lean']) c[m] = jest.fn(() => c);
  c.exec = jest.fn(async () => result);
  return c;
};

describe('SupplyInvoiceService: приход по счёту', () => {
  const invId = new Types.ObjectId();
  const mk = (status: string) => ({ _id: new Types.ObjectId(), num: 1, title: 'Болт', status, invoiceId: invId });
  let lines: Array<Record<string, unknown>>;
  let supply: { receive: jest.Mock };
  let svc: SupplyInvoiceService;

  beforeEach(() => {
    lines = [mk('ordered'), mk('received'), mk('ordered')];
    supply = { receive: jest.fn(async () => ({})) };
    const model = { findOne: jest.fn(() => chain({ _id: invId, status: 'paid', fileIds: [] })) };
    const requests = { find: jest.fn(() => chain(lines)) };
    const connection = { db: { collection: () => ({ find: () => ({ toArray: async () => [] }) }) } };
    svc = new SupplyInvoiceService(connection as never, model as never, requests as never, supply as never, {} as never, { toRoles: async () => 0 } as never);
    jest.spyOn(svc, 'get').mockResolvedValue({ id: String(invId) } as never);
  });

  it('по умолчанию принимает только неполученные', async () => {
    const r = await svc.receive(String(invId), undefined, 'u1');
    expect(supply.receive).toHaveBeenCalledTimes(2);
    expect(r.receivedCount).toBe(2);
  });
  it('повторный приём уже полученной — 409, ничего не принято', async () => {
    await expect(svc.receive(String(invId), [String(lines[1]._id), String(lines[0]._id)])).rejects.toBeInstanceOf(ConflictException);
    expect(supply.receive).not.toHaveBeenCalled();
  });
  it('всё получено — 409', async () => {
    lines.forEach((l) => { l.status = 'received'; });
    await expect(svc.receive(String(invId), undefined)).rejects.toThrow('уже приняты');
  });
  it('чужая заявка — 400', async () => {
    await expect(svc.receive(String(invId), [String(new Types.ObjectId())])).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Деньги без задвоения (З14)', () => {
  it('календарь берёт расход только по заявкам, не по счетам', () => {
    const src = readFileSync(join(__dirname, '../finance/finance.service.ts'), 'utf8');
    expect(src).toContain("collection('supplyrequests')");
    expect(src).not.toContain('supplyinvoices');
  });
});

describe('SupplyInvoiceService: дубль № у поставщика', () => {
  const sup = new Types.ObjectId();
  const cur = { _id: new Types.ObjectId(), supplierId: sup, status: 'draft', amount: 100, fileIds: [new Types.ObjectId()], no: undefined as string | undefined };
  const f1 = new Types.ObjectId();
  let others: Array<Record<string, unknown>>;
  let invUpdates: Array<[unknown, unknown]>;
  let reqUpdates: Array<[unknown, unknown]>;
  let svc: SupplyInvoiceService;
  const dupDoc = (o: Record<string, unknown> = {}) => ({ _id: new Types.ObjectId(), supplierId: sup, no: ' №41125', status: 'draft', amount: 50, fileIds: [f1], date: new Date('2026-10-01'), ...o });

  beforeEach(() => {
    others = [];
    invUpdates = []; reqUpdates = [];
    const model = {
      findOne: jest.fn(() => chain({ ...cur })),
      find: jest.fn(() => chain(others)),
      updateOne: jest.fn((f: unknown, u: unknown) => { invUpdates.push([f, u]); return chain({}); }),
    };
    const requests = { updateMany: jest.fn((f: unknown, u: unknown) => { reqUpdates.push([f, u]); return chain({}); }) };
    const connection = { startSession: async () => ({ withTransaction: async (fn: () => Promise<void>) => fn(), endSession: async () => undefined }) };
    svc = new SupplyInvoiceService(connection as never, model as never, requests as never, {} as never, {} as never, { toRoles: async () => 0 } as never);
    jest.spyOn(svc, 'get').mockImplementation(async (id: string) => ({ id }) as never);
  });

  it('склеивает: заявки, сумма, файлы, удаление второго, warnings', async () => {
    const dup = dupDoc(); others = [dup];
    const r = await svc.update(String(cur._id), { no: '41125' } as never) as unknown as { id: string; warnings: string[] };
    expect(r.id).toBe(String(dup._id));
    expect(r.warnings[0]).toContain('уже есть');
    expect(reqUpdates[0][0]).toMatchObject({ invoiceId: cur._id });
    expect((reqUpdates[0][1] as { $set: { invoiceId: unknown } }).$set.invoiceId).toBe(dup._id);
    const upd = invUpdates.find(([f]) => (f as { _id: unknown })._id === dup._id)![1] as { $set: { amount: number; fileIds: unknown[] } };
    expect(upd.$set.amount).toBe(150);
    expect(upd.$set.fileIds).toHaveLength(2);
    const del = invUpdates.find(([f]) => (f as { _id: unknown })._id === cur._id)![1] as { $set: { deletedAt: Date; mergedInto: unknown } };
    expect(del.$set.deletedAt).toBeInstanceOf(Date);
    expect(del.$set.mergedInto).toBe(dup._id);
  });
  it('найденный оплачен — 409', async () => {
    others = [dupDoc({ status: 'paid' })];
    await expect(svc.update(String(cur._id), { no: '41125' } as never)).rejects.toBeInstanceOf(ConflictException);
    expect(reqUpdates).toHaveLength(0);
  });
  it('другой № — не склеивает', async () => {
    others = [dupDoc({ no: '999' })];
    const r = await svc.update(String(cur._id), { no: "41125" } as never) as unknown as { id: string };
    expect(r.id).toBe(String(cur._id));
    expect(reqUpdates).toHaveLength(0);
  });
  it('поиск дубля — только того же поставщика и не отменённых', async () => {
    others = [];
    await svc.update(String(cur._id), { no: '41125' } as never);
    const model = (svc as unknown as { model: { find: jest.Mock } }).model;
    expect(model.find).toHaveBeenCalledWith({ supplierId: sup, deletedAt: null, status: { $ne: 'cancelled' }, _id: { $ne: cur._id } });
  });
});
