import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { assertOneLive, bindDraft } from './passport-bind';

const chain = (v: unknown) => ({ select: () => chain(v), session: () => chain(v), lean: () => chain(v), exec: async () => v });

/** Память вместо Mongo: организации (наши фирмы) и одна позиция заказа. */
function mem(opts: { orgs?: Types.ObjectId[]; income?: Record<string, unknown> | null } = {}) {
  const orgs = opts.orgs ?? [];
  return {
    collection(name: string) {
      return {
        countDocuments: async () => (name === 'organizations' ? orgs.length : 0),
        find: () => ({ limit: () => ({ toArray: async () => (name === 'organizations' ? orgs.map((_id) => ({ _id })) : []) }) }),
        findOne: async (q: { _id?: Types.ObjectId }) => {
          if (name === 'organizations' && orgs.length === 1) return { _id: orgs[0] };
          if (name === 'incomes') return opts.income && q._id && String(opts.income._id) === String(q._id) ? opts.income : null;
          if (name === 'salesorders' && opts.income?.orderId) return { _id: opts.income.orderId, orderNo: '12', customer: 'Парк' };
          return null;
        },
      };
    },
  } as never;
}

describe('bindDraft', () => {
  const product = new Types.ObjectId();
  const firm = new Types.ObjectId();
  const other = new Types.ObjectId();

  it('несколько фирм и фирма не выбрана — 400', async () => {
    await expect(bindDraft(mem({ orgs: [firm, other] }), { productId: String(product) })).rejects.toThrow('Выберите фирму');
  });

  it('одна фирма — подставляется сама; ноль фирм — черновик без фирмы; без изделия — можно (legacy)', async () => {
    const r = await bindDraft(mem({ orgs: [firm] }), { productId: String(product) });
    expect(r.supplierOrgId).toBe(String(firm));
    expect(r.productId).toBe(String(product));
    const bare = await bindDraft(mem({ orgs: [] }), { productId: String(product) });
    expect(bare.supplierOrgId).toBeUndefined();
    await expect(bindDraft(mem({ orgs: [] }), {})).resolves.toMatchObject({});
  });

  it('переданная фирма не затирается', async () => {
    const r = await bindDraft(mem({ orgs: [firm] }), { productId: String(product), supplierOrgId: String(other) });
    expect(r.supplierOrgId).toBe(String(other));
  });

  it('черновик позиции берёт изделие у позиции; при двух фирмах фирму не угадывает', async () => {
    const income = new Types.ObjectId();
    const order = new Types.ObjectId();
    await expect(bindDraft(mem({ orgs: [firm, other], income: { _id: income, productId: product, orderId: order } }), { incomeId: String(income) })).rejects.toBeInstanceOf(BadRequestException);
    const one = await bindDraft(mem({ orgs: [firm], income: { _id: income, productId: product, orderId: order } }), { incomeId: String(income) });
    expect(one.productId).toBe(String(product));
    expect(one.supplierOrgId).toBe(String(firm));
    expect(one.orderNo).toBe('12');
  });
});

describe('assertOneLive', () => {
  const income = new Types.ObjectId();

  it('нет второго живого — проходит, пустой incomeId не ищет', async () => {
    await assertOneLive({ findOne: () => chain(null) } as never, income);
    await assertOneLive({ findOne: () => { throw new Error('не звать'); } } as never, '');
  });

  it('живой на ту же позицию — 409', async () => {
    const model = { findOne: () => chain({ passportNumber: '15' }) };
    await expect(assertOneLive(model as never, income)).rejects.toBeInstanceOf(ConflictException);
    await expect(assertOneLive(model as never, income)).rejects.toThrow('№ 15');
  });

  it('себя и аннулированных в запрос не включает', async () => {
    let q: Record<string, unknown> = {};
    const self = new Types.ObjectId();
    const model = { findOne: (query: Record<string, unknown>) => { q = query; return chain(null); } };
    await assertOneLive(model as never, String(income), self);
    expect(q.status).toEqual({ $ne: 'annulled' });
    expect(q._id).toEqual({ $ne: self });
    expect(String(q.incomeId)).toBe(String(income));
  });
});
