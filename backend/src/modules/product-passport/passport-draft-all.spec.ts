import { Types } from 'mongoose';
import { ProductPassportService } from './product-passport.service';

/** Черновики паспортов на все позиции заказа: только недостающие, повтор — 0 созданных. */
describe('createDraftsForOrder', () => {
  const o = new Types.ObjectId(), i1 = new Types.ObjectId(), i2 = new Types.ObjectId();
  const make = (have: Types.ObjectId[]) => {
    const made: Array<Record<string, unknown>> = [];
    const svc = Object.create(ProductPassportService.prototype) as Record<string, unknown>;
    svc.oid = (v: unknown) => new Types.ObjectId(String(v));
    svc.model = { exists: async (q: { incomeId: Types.ObjectId }) => (have.some((h) => h.equals(q.incomeId)) ? { _id: 1 } : null) };
    svc.create = async (dto: Record<string, unknown>) => { made.push(dto); have.push(new Types.ObjectId(String(dto.incomeId))); return { _id: new Types.ObjectId() }; };
    const col = (name: string) => name === 'salesorders'
      ? { findOne: async () => ({ _id: o }) }
      : { find: () => ({ sort: () => ({ toArray: async () => [{ _id: i1, title: 'Урна А' }, { _id: i2, title: 'Урна Б' }] }) }) };
    svc.connection = { db: { collection: col } };
    return { svc: svc as unknown as ProductPassportService, made };
  };
  it('создаёт только недостающие, название из позиции', async () => {
    const { svc, made } = make([i1]);
    const r = await svc.createDraftsForOrder(String(o));
    expect(r).toMatchObject({ created: 1, skipped: 1 });
    expect(r.items[0].incomeId).toBe(String(i2));
    expect(made[0]).toMatchObject({ incomeId: String(i2), name: 'Урна Б' });
  });
  it('повторный вызов — 0 созданных', async () => {
    const { svc, made } = make([]);
    expect((await svc.createDraftsForOrder(String(o))).created).toBe(2);
    expect(await svc.createDraftsForOrder(String(o))).toEqual({ created: 0, skipped: 2, items: [] });
    expect(made).toHaveLength(2);
  });
});
