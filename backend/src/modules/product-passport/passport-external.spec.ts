import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PassportExternal } from './passport-external';
import { assertNotExternal } from './passport-consts';
import { warrantyCodeFor } from './passport-rules';

/** Хозяин на памяти: счётчики и «база» паспортов, чтобы проверить выдачу номеров без Mongo. */
function make(start = { p: 549, c: 2577 }) {
  const docs: Array<Record<string, unknown>> = [];
  const seq = { passportNumber: start.p, productCode: start.c };
  const pid = new Types.ObjectId();
  const h = {
    model: { create: async ([d]: Array<Record<string, unknown>>) => { docs.push(d); }, findById: () => ({ exec: async () => docs[docs.length - 1] }) },
    connection: { collection: () => ({ findOne: async () => ({ name: 'Турник', category: 'Воркаут' }) }), startSession: async () => ({ withTransaction: (fn: () => Promise<void>) => fn(), endSession: async () => undefined }) },
    maxOf: async () => 0,
    counter: async (k: 'passportNumber' | 'productCode') => seq[k],
    allocate: async (set: Record<string, unknown>, date: Date) => {
      if (!set.passportNumber) { seq.passportNumber++; set.passportNumber = String(seq.passportNumber); }
      if (!set.productCode) { seq.productCode++; set.productCode = String(seq.productCode); }
      if (!set.warrantyCode) set.warrantyCode = warrantyCodeFor(date, String(set.passportNumber));
    },
    assertFree: async (set: Record<string, unknown>) => {
      for (const f of ['passportNumber', 'productCode', 'warrantyCode']) if (set[f] && docs.some((d) => d[f] === set[f])) throw new ConflictException(`${f} ${set[f]} уже занят`);
    },
  };
  return { ext: new PassportExternal(h as never), docs, pid: String(pid), h };
}

describe('PassportExternal (ПН)', () => {
  it('следующие номера — показ, ничего не занимает', async () => {
    const { ext, docs } = make();
    const a = await ext.nextNumbers(new Date(Date.UTC(2026, 9, 13)));
    expect(a).toEqual({ lastPassportNo: 549, nextPassportNo: 550, nextWarrantyCode: '202610-550', lastProductCode: 2577, nextProductCode: 2578 });
    expect(await ext.nextNumbers(new Date(Date.UTC(2026, 9, 13)))).toEqual(a);
    expect(docs).toHaveLength(0);
  });

  it('два подряд — разные номера, талон ГГГГМ-№, external', async () => {
    const { ext, pid } = make();
    const a = (await ext.create({ productId: pid, date: '2026-10-13' })) as unknown as Record<string, unknown>;
    const b = (await ext.create({ productId: pid, date: '2026-10-13' })) as unknown as Record<string, unknown>;
    expect([a.passportNumber, b.passportNumber]).toEqual(['550', '551']);
    expect(a.warrantyCode).toBe('202610-550');
    expect(a.productCode).not.toBe(b.productCode);
    expect(a).toMatchObject({ status: 'issued', source: 'external', external: true, name: 'Турник' });
  });

  it('ведущие нули убираются', async () => {
    const { ext, pid } = make();
    const a = (await ext.create({ productId: pid, passportNumber: '0701', productCode: '0042' })) as unknown as Record<string, unknown>;
    expect([a.passportNumber, a.passportNo, a.productCode]).toEqual(['701', 701, '42']);
  });

  it('E11000 в транзакции → 409', async () => {
    const { ext, pid, h } = make();
    h.model.create = async () => { throw Object.assign(new Error('dup'), { code: 11000 }); };
    await expect(ext.create({ productId: pid })).rejects.toBeInstanceOf(ConflictException);
  });

  it('внешний паспорт: печать и выпуск недоступны (400)', () => {
    expect(() => assertNotExternal({ external: true })).toThrow(BadRequestException);
    expect(() => assertNotExternal({})).not.toThrow();
  });

  it('переданный занятый номер — 409', async () => {
    const { ext, pid } = make();
    await ext.create({ productId: pid, passportNumber: '700', date: '2026-10-13' });
    await expect(ext.create({ productId: pid, passportNumber: '700' })).rejects.toBeInstanceOf(ConflictException);
  });
});
