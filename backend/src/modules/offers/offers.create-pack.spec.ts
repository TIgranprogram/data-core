import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OffersService } from './offers.service';

/** C081: POST /offers/pack — N КП одним вызовом, проверки до записи, откат при сбое. */
describe('OffersService: createPack (воронка «Новое КП»)', () => {
  const a = new Types.ObjectId();
  const b = new Types.ObjectId();
  const c = new Types.ObjectId();
  let blanks: Types.ObjectId[];
  let model: { create: jest.Mock; collection: { deleteMany: jest.Mock } };
  let svc: OffersService;
  const user = { id: 'u', username: 'm', role: 'manager' } as never;
  const items = [{ productName: 'Мостик', quantity: 2, unit: 'шт', unitPrice: 1000 }];
  const base = { customer: 'ООО Заказчик', items };

  beforeEach(() => {
    blanks = [a, b, c];
    const orgs = [a, b, c].map((_id, i) => ({ _id, name: `Фирма ${i + 1}`, isOurCompany: true, vatRate: 22, deletedAt: null }));
    const coll = (name: string) => {
      if (name === 'offerbackgrounds') return { countDocuments: async (q: { companyId: Types.ObjectId }) => (blanks.some((x) => String(x) === String(q.companyId)) ? 1 : 0) };
      if (name === 'settings') return { findOne: async () => null };
      return { findOne: async (q: { _id?: Types.ObjectId }) => orgs.find((o) => String(o._id) === String(q._id)) ?? null, find: () => ({ toArray: async () => orgs }) };
    };
    let n = 0;
    model = {
      create: jest.fn(async (d: Record<string, unknown>) => { const _id = new Types.ObjectId(); return { _id, toObject: () => ({ _id, ...d }) }; }),
      collection: { deleteMany: jest.fn(async () => ({})) },
    };
    const counters = { next: jest.fn(async () => `КП-${++n}`) };
    const bgs = { defaultTerms: jest.fn(async () => 'Текст фирмы.') };
    svc = new OffersService({ db: { collection: coll } } as never, model as never, counters as never, bgs as never, {} as never, {} as never);
  });

  it('три фирмы: три КП, общий packId, наценка по каждой', async () => {
    const r = await svc.createPack({ ...base, companies: [{ companyId: String(a) }, { companyId: String(b), markupPercent: 3 }, { companyId: String(c), markupPercent: 5 }] }, user);
    expect(model.create).toHaveBeenCalledTimes(3);
    expect(model.create.mock.calls.map((x) => x[0].total)).toEqual([2000, 2060, 2100]);
    expect(r.packId).toMatch(/^[a-f0-9]{24}$/);
    expect(new Set(model.create.mock.calls.map((x) => x[0].packId))).toEqual(new Set([r.packId]));
    expect(r.items).toHaveLength(3);
    expect(model.create.mock.calls[0][0].terms).toBe('Текст фирмы.');
  });

  it('одна фирма: одно КП без packId', async () => {
    const r = await svc.createPack({ ...base, companies: [{ companyId: String(a) }] }, user);
    expect(r.packId).toBeNull();
    expect(model.create.mock.calls[0][0].packId).toBeUndefined();
  });

  it('нет бланка у второй фирмы — 400, ничего не записано', async () => {
    blanks = [a];
    await expect(svc.createPack({ ...base, companies: [{ companyId: String(a) }, { companyId: String(b) }] }, user)).rejects.toThrow(/нет бланка КП/);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('повтор фирмы и пустой список — 400 до записи', async () => {
    await expect(svc.createPack({ ...base, companies: [{ companyId: String(a) }, { companyId: String(a) }] }, user)).rejects.toThrow(/дважды/);
    await expect(svc.createPack({ ...base, companies: [] }, user)).rejects.toThrow(BadRequestException);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('сбой на втором КП: созданное первое удаляется, ошибка уходит наружу', async () => {
    const real = model.create.getMockImplementation()!;
    model.create.mockImplementationOnce(real).mockRejectedValueOnce(new Error('сбой записи'));
    await expect(svc.createPack({ ...base, companies: [{ companyId: String(a) }, { companyId: String(b) }] }, user)).rejects.toThrow('сбой записи');
    expect(model.collection.deleteMany).toHaveBeenCalledTimes(1);
    const arg = model.collection.deleteMany.mock.calls[0] as unknown as [{ _id: { $in: unknown[] } }];
    expect(arg[0]._id.$in).toHaveLength(1);
  });
});
