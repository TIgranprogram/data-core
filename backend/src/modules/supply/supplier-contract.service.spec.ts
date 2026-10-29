import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SupplierContractService } from './supplier-contract.service';
import { SupplyInvoiceService } from './supply-invoice.service';

const chain = (result: unknown) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'skip', 'limit', 'lean']) c[m] = jest.fn(() => c);
  c.exec = jest.fn(async () => result);
  return c;
};

const supplier = new Types.ObjectId();
const org = { _id: supplier, name: 'Крепёж', shortName: 'Крепёж' };

/** Фейковое подключение: коллекции отдают заданные массивы. */
const conn = (data: Record<string, unknown[]>) => ({
  db: {
    collection: (n: string) => ({
      findOne: async () => (data[n] ?? [])[0] ?? null,
      find: () => ({ toArray: async () => data[n] ?? [] }),
    }),
  },
});

describe('SupplierContractService', () => {
  const make = (opts: { exists?: boolean; invoices?: unknown[]; found?: unknown } = {}) => {
    const model = {
      exists: jest.fn(async () => (opts.exists ? { _id: 1 } : null)),
      create: jest.fn(async (d: object) => ({ _id: new Types.ObjectId(), ...d })),
      findOne: jest.fn(() => chain(opts.found ?? null)),
      updateOne: jest.fn(() => ({ exec: async () => ({}) })),
    };
    const svc = new SupplierContractService(conn({ organizations: [org], supplyinvoices: opts.invoices ?? [] }) as never, model as never);
    return { svc, model };
  };

  it('повтор № у того же поставщика — 409', async () => {
    const { svc } = make({ exists: true });
    const p = svc.create({ supplierId: String(supplier), no: '5', date: '2026-10-01' }, undefined);
    await expect(p).rejects.toBeInstanceOf(ConflictException);
    await expect(p).rejects.toThrow('У этого поставщика уже есть договор № 5');
  });

  it('гонка: ошибка уникального индекса тоже даёт 409', async () => {
    const { svc, model } = make();
    model.create.mockRejectedValueOnce({ code: 11000 });
    await expect(svc.create({ supplierId: String(supplier), no: '5', date: '2026-10-01' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('кривая дата — 400', async () => {
    const { svc } = make();
    await expect(svc.create({ supplierId: String(supplier), no: '5', date: 'вчера' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('пустой № после обрезки — 400', async () => {
    const { svc } = make();
    await expect(svc.create({ supplierId: String(supplier), no: '   ', date: '2026-10-01' })).rejects.toThrow('Укажите № договора');
  });

  it('неизвестный поставщик — 400', async () => {
    const model = { exists: jest.fn(), create: jest.fn() };
    const svc = new SupplierContractService(conn({ organizations: [] }) as never, model as never);
    await expect(svc.create({ supplierId: String(supplier), no: '1', date: '2026-10-01' })).rejects.toBeInstanceOf(BadRequestException);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('удаление со счетами — 409 с номерами', async () => {
    const id = new Types.ObjectId();
    const { svc, model } = make({ found: { _id: id, supplierId: supplier }, invoices: [{ _id: new Types.ObjectId(), contractId: id, no: '17' }, { _id: new Types.ObjectId(), contractId: id, no: '18' }] });
    const p = svc.remove(String(id));
    await expect(p).rejects.toBeInstanceOf(ConflictException);
    await expect(p).rejects.toThrow('привязано 2 счёта (№ 17, 18)');
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('удаление без счетов — мягкое (deletedAt)', async () => {
    const id = new Types.ObjectId();
    const { svc, model } = make({ found: { _id: id, supplierId: supplier } });
    await expect(svc.remove(String(id))).resolves.toEqual({ id: String(id), deleted: true });
    expect(model.updateOne).toHaveBeenCalledWith({ _id: id }, { $set: { deletedAt: expect.any(Date) } });
  });

  it('смена № на занятый — 409', async () => {
    const id = new Types.ObjectId();
    const { svc } = make({ found: { _id: id, supplierId: supplier, no: '1' }, exists: true });
    await expect(svc.update(String(id), { no: '2' })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('SupplyInvoiceService: договор в счёте', () => {
  const invId = new Types.ObjectId();
  const other = new Types.ObjectId();
  const cid = new Types.ObjectId();

  const make = (contract: Record<string, unknown> | null, inv: Record<string, unknown> = {}) => {
    const model = {
      findOne: jest.fn(() => chain({ _id: invId, status: 'draft', supplierId: supplier, fileIds: [], ...inv })),
      updateOne: jest.fn<unknown, [object, Record<string, Record<string, unknown>>]>(() => ({ exec: async () => ({}) })),
    };
    const session = { withTransaction: async (fn: () => Promise<void>) => fn(), endSession: async () => undefined };
    const connection = {
      startSession: async () => session,
      db: { collection: (n: string) => ({
        findOne: async () => (n === 'suppliercontracts' ? contract : n === 'organizations' ? { _id: other, name: 'Металл' } : null),
        find: () => ({ toArray: async () => [] }),
      }) },
    };
    const requests = { find: jest.fn(() => chain([])), updateMany: jest.fn(() => ({ exec: async () => ({}) })) };
    const svc = new SupplyInvoiceService(connection as never, model as never, requests as never, {} as never, {} as never, { toRoles: async () => 0 } as never);
    jest.spyOn(svc, 'get').mockResolvedValue({ id: String(invId) } as never);
    return { svc, model };
  };

  it('договор другого поставщика — 400', async () => {
    const { svc } = make({ _id: cid, supplierId: other, status: 'active' });
    const p = svc.update(String(invId), { contractId: String(cid) });
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow('Договор другого поставщика');
  });

  it('несуществующий договор — 400', async () => {
    const { svc } = make(null);
    await expect(svc.update(String(invId), { contractId: String(cid) })).rejects.toThrow('Договор не найден');
  });

  it('закрытый договор выбрать нельзя, а уже выбранный — можно', async () => {
    const closed = { _id: cid, supplierId: supplier, status: 'closed' };
    await expect(make(closed).svc.update(String(invId), { contractId: String(cid) })).rejects.toThrow('закрыт');
    const same = make(closed, { contractId: cid });
    await same.svc.update(String(invId), { contractId: String(cid) });
    expect(same.model.updateOne).toHaveBeenCalled();
  });

  it('свой договор сохраняется', async () => {
    const { svc, model } = make({ _id: cid, supplierId: supplier, status: 'active' });
    await svc.update(String(invId), { contractId: String(cid) });
    expect(model.updateOne.mock.calls[0][1]).toEqual({ $set: { contractId: cid } });
  });

  it('фильтр списка contract=none/has; другое значение — 400', async () => {
    const { svc, model } = make(null);
    const find = jest.fn(() => chain([]));
    Object.assign(model, { find, countDocuments: () => ({ exec: async () => 0 }), aggregate: () => ({ exec: async () => [] }) });
    await svc.list({ contract: 'none' });
    expect(find.mock.calls[0] as unknown[]).toEqual([expect.objectContaining({ contractId: null })]);
    await svc.list({ contract: 'has' });
    expect(find.mock.calls[1] as unknown[]).toEqual([expect.objectContaining({ contractId: { $ne: null } })]);
    await expect(svc.list({ contract: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('"" снимает договор', async () => {
    const { svc, model } = make(null, { contractId: cid });
    await svc.update(String(invId), { contractId: '' });
    expect(model.updateOne.mock.calls[0][1]).toEqual({ $unset: { contractId: '' } });
  });

  it('смена поставщика сбрасывает договор и предупреждает', async () => {
    const { svc, model } = make(null, { contractId: cid });
    const r = await svc.update(String(invId), { supplierId: String(other) }) as { warnings?: string[] };
    expect(model.updateOne.mock.calls[0][1].$unset).toEqual({ contractId: '' });
    expect(r.warnings?.[0]).toContain('Договор снят');
  });

  it('смена поставщика вместе с договором нового поставщика — договор сохраняется', async () => {
    const { svc, model } = make({ _id: cid, supplierId: other, status: 'active' }, { contractId: new Types.ObjectId() });
    const r = await svc.update(String(invId), { supplierId: String(other), contractId: String(cid) }) as { warnings?: string[] };
    expect(model.updateOne.mock.calls[0][1].$set.contractId).toEqual(cid);
    expect(r.warnings).toBeUndefined();
  });
});
