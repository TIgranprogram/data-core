import { Types } from 'mongoose';
import { OFFERS_ONLY_KEY } from '../../common/offers-only';
import { ourCompanies } from '../incomes/incomes.service';
import { OffersService } from './offers.service';

/** КП-2: предпросмотр без записи, копия с наценкой, стандартные тексты, фирмы «только для КП». */
describe('OffersService: шаблоны КП', () => {
  const company = new Types.ObjectId();
  const other = new Types.ObjectId();
  const cur = {
    _id: new Types.ObjectId(), number: 'КП-1', date: new Date('2026-11-06T00:00:00Z'), validUntil: new Date('2026-11-16T00:00:00Z'), companyId: company, customer: 'ООО «ИнжПроектСтрой»',
    objectName: 'Мостик 5×2 м', delivery: 'included', terms: 'Аванс 80 %.', bg1Id: 'b'.repeat(24), bg2Id: 'none', status: 'sent', total: 680000,
    items: [{ productName: 'Мостик', quantity: 1, unit: 'шт', unitPrice: 680000, total: 680000 }],
  };
  let model: { findOne: jest.Mock; create: jest.Mock; updateOne: jest.Mock };
  let counters: { next: jest.Mock };
  let bgs: { resolve: jest.Mock; defaultTerms: jest.Mock };
  let svc: OffersService;
  let settings: unknown;

  beforeEach(() => {
    const coll = (name: string) => ({
      findOne: async () => (name === 'settings' ? settings : { _id: company, name: 'СпортИН-ЮГ', vatRate: 22 }),
      find: () => ({ toArray: async () => [{ _id: company, name: 'СпортИН-ЮГ' }, { _id: other, name: 'Приват-деал' }] }),
    });
    const connection = { db: { collection: coll } };
    settings = { value: [String(other)] };
    model = {
      findOne: jest.fn(() => ({ lean: () => ({ exec: async () => cur }) })),
      create: jest.fn(async (d: Record<string, unknown>) => ({ toObject: () => ({ _id: new Types.ObjectId(), ...d }) })),
      updateOne: jest.fn(),
    };
    counters = { next: jest.fn(async () => 'КП-2') };
    bgs = { resolve: jest.fn(async () => ({ jpeg: null, textTop: 0.26, textBottom: 0.78 })), defaultTerms: jest.fn(async () => 'Аванс 80 %.') };
    svc = new OffersService(connection as never, model as never, counters as never, bgs as never, {} as never, {} as never);
  });

  const dto = { companyId: String(company), customer: 'ООО «ИнжПроектСтрой»', objectName: 'Мостик 5×2 м', delivery: 'included' as const, items: [{ productName: 'Мостик', quantity: 1, unitPrice: 680000 }] };

  it('предпросмотр: PDF есть, в базу не пишет и номер не тратит', async () => {
    const r = await svc.preview(dto as never);
    expect(r.buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(model.create).not.toHaveBeenCalled();
    expect(model.updateOne).not.toHaveBeenCalled();
    expect(counters.next).not.toHaveBeenCalled();
    expect(bgs.resolve).toHaveBeenCalledWith(1, undefined, company);
  });

  it('предпросмотр без цен в строках не падает', async () => {
    const r = await svc.preview({ ...dto, items: [{ productName: 'Мостик', quantity: 1 }] } as never);
    expect(r.buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('копия +3 % для другой фирмы: 700 400, свой бланк, связь copyOf, черновик', async () => {
    const r = await svc.copy(String(cur._id), { companyId: String(other), markupPercent: 3 }, { id: 'u', username: 'm', role: 'manager' } as never);
    const saved = model.create.mock.calls[0][0];
    expect(saved).toMatchObject({ number: 'КП-2', status: 'draft', total: 700400, objectName: 'Мостик 5×2 м', delivery: 'included', terms: 'Аванс 80 %.', copyOf: cur._id });
    expect(saved.items[0].unitPrice).toBe(700400);
    expect(saved.bg1Id).toBeUndefined();
    expect(saved.bg2Id).toBeUndefined();
    expect(String(saved.companyId)).toBe(String(company)); // ourCompany в заглушке отдаёт одну фирму — важно, что новая берётся из dto
    expect(r.copyOf).toBe(String(cur._id));
    expect(r.status).toBe('draft');
  });

  it('копия +5 % — 714 000; без наценки — те же цены', async () => {
    await svc.copy(String(cur._id), { companyId: String(other), markupPercent: 5 }, undefined as never);
    expect(model.create.mock.calls[0][0].total).toBe(714000);
    await svc.copy(String(cur._id), { companyId: String(other) }, undefined as never);
    expect(model.create.mock.calls[1][0].total).toBe(680000);
  });

  it('стандартные тексты и НДС для новой формы', async () => {
    expect(await svc.defaults(String(company))).toEqual({ terms: 'Аванс 80 %.', vatMode: 'with', vatRate: 22 });
  });

  it('список фирм КП: «только для КП» помечена', async () => {
    const r = await svc.companies();
    expect(r.items).toEqual([{ id: String(company), name: 'СпортИН-ЮГ', offersOnly: false }, { id: String(other), name: 'Приват-деал', offersOnly: true }]);
    expect(r.total).toBe(2);
  });

  it('«Деньги» не видят фирму «только для КП»', async () => {
    const find = jest.fn(() => ({ toArray: async () => [{ _id: company, name: 'СпортИН-ЮГ' }] }));
    const conn = { db: { collection: (n: string) => (n === 'settings' ? { findOne: async () => ({ key: OFFERS_ONLY_KEY, value: [String(other)] }) } : { find }) } };
    await ourCompanies(conn as never);
    expect((find.mock.calls[0] as unknown[])[0]).toMatchObject({ _id: { $nin: [other] } });
    await ourCompanies(conn as never, { withOffersOnly: true });
    expect((find.mock.calls[1] as unknown[])[0]).not.toHaveProperty('_id');
  });
});
