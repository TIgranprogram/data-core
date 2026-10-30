import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PartnersService } from './partners.service';

function setup(mkRows: (from: Types.ObjectId, to: Types.ObjectId) => Record<string, Array<Record<string, unknown>>> = () => ({})) {
  const from = new Types.ObjectId(), to = new Types.ObjectId();
  const rows = mkRows(from, to);
  const orgs: Record<string, unknown>[] = [{ _id: from, name: 'А', inn: '111' }, { _id: to, name: 'Б', shortName: 'Б', inn: '222' }];
  const upd: Record<string, jest.Mock> = {};
  const coll = (n: string) => ({
    findOne: async (f: { _id: Types.ObjectId }) => (n === 'organizations' ? orgs.find((o) => String(o._id) === String(f._id)) ?? null : null),
    find: (f: { supplierId?: Types.ObjectId }) => ({ toArray: async () => (rows[n] ?? []).filter((r) => String(r.supplierId) === String(f.supplierId)) }),
    updateMany: (upd[`${n}.many`] = jest.fn(async () => ({ modifiedCount: 1 }))),
    updateOne: (upd[`${n}.one`] = jest.fn(async () => ({}))),
  });
  const connection = { db: { collection: coll }, startSession: async () => ({ withTransaction: async (cb: () => Promise<void>) => cb(), endSession: async () => undefined }) };
  const svc = new PartnersService(connection as never);
  jest.spyOn(svc, 'get').mockResolvedValue({} as never);
  return { svc, from, to, upd };
}

describe('HARDEN-1 п.16: объединение поставщиков', () => {
  it('переносит счета, договоры и каталог', async () => {
    const t = setup();
    await t.svc.merge(String(t.from), String(t.to));
    for (const c of ['supplyrequests', 'supplyinvoices', 'suppliercontracts', 'supplieritems']) {
      expect(t.upd[`${c}.many`]).toHaveBeenCalledWith({ supplierId: t.from }, { $set: expect.objectContaining({ supplierId: t.to }) }, expect.anything());
    }
  });
  it('одинаковый № договора у обоих — 409, ничего не перенесено', async () => {
    const t = setup((from, to) => ({ suppliercontracts: [{ supplierId: from, no: '5' }, { supplierId: to, no: '5' }] }));
    await expect(t.svc.merge(String(t.from), String(t.to))).rejects.toBeInstanceOf(ConflictException);
    expect(t.upd['supplyrequests.many']).toBeUndefined();
  });
});

describe('HARDEN-1: каталог поставщика — конфликт ключа с удалёнными записями', () => {
  it('удалённая позиция цели тоже блокирует (индекс без partialFilter)', async () => {
    const t = setup((from, to) => ({ supplieritems: [{ supplierId: from, article: 'A', color: '' }, { supplierId: to, article: 'A', color: '', deletedAt: new Date() }] }));
    await expect(t.svc.merge(String(t.from), String(t.to))).rejects.toThrow('позиции каталога');
  });

  it('чужой уникальный индекс (CRM) — 409 вместо 500', async () => {
    const t = setup();
    const conn = (t.svc as unknown as { connection: { startSession: () => Promise<unknown> } }).connection;
    jest.spyOn(conn, 'startSession').mockResolvedValue({ withTransaction: async () => { throw Object.assign(new Error('E11000'), { code: 11000 }); }, endSession: async () => undefined });
    await expect(t.svc.merge(String(t.from), String(t.to))).rejects.toBeInstanceOf(ConflictException);
  });
});
