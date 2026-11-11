import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OffersService } from './offers.service';

/** C071: пакет копий КП — проверки 400, общий packId, наценка. */
describe('OffersService: пакет КП (copyMany)', () => {
  const company = new Types.ObjectId();
  const other = new Types.ObjectId();
  const third = new Types.ObjectId();
  const cur = {
    _id: new Types.ObjectId(), number: 'КП-1', date: new Date('2026-11-06T00:00:00Z'), validUntil: new Date('2026-11-16T00:00:00Z'),
    companyId: company, customer: 'ООО «ИнжПроектСтрой»', objectName: 'Мостик 5×2 м', delivery: 'included',
    terms: 'Аванс 80 %.', status: 'sent', total: 680000, packId: undefined as string | undefined,
    items: [{ productName: 'Мостик', quantity: 1, unit: 'шт', unitPrice: 680000, total: 680000 }],
  };
  let model: { findOne: jest.Mock; create: jest.Mock; updateOne: jest.Mock; countDocuments: jest.Mock; aggregate: jest.Mock };
  let counters: { next: jest.Mock };
  let bgs: { resolve: jest.Mock; defaultTerms: jest.Mock };
  let svc: OffersService;
  let blanks: Types.ObjectId[];
  let orgs: Array<{ _id: Types.ObjectId; name: string; isOurCompany?: boolean; vatRate?: number; deletedAt: null }>;

  beforeEach(() => {
    blanks = [other, third];
    orgs = [
      { _id: company, name: 'СпортИН-ЮГ', isOurCompany: true, vatRate: 22, deletedAt: null },
      { _id: other, name: 'Приват-деал', isOurCompany: true, vatRate: 22, deletedAt: null },
      { _id: third, name: 'ССЮ', isOurCompany: true, vatRate: 22, deletedAt: null },
    ];
    const coll = (name: string) => {
      if (name === 'offerbackgrounds') {
        return {
          find: () => ({ toArray: async () => blanks.map((id) => ({ companyId: id, page: 1 })) }),
          countDocuments: async (q: { companyId: Types.ObjectId }) => (blanks.some((b) => String(b) === String(q.companyId)) ? 1 : 0),
        };
      }
      if (name === 'settings') return { findOne: async () => null };
      return {
        findOne: async (q: { _id?: Types.ObjectId }) => orgs.find((o) => String(o._id) === String(q._id)) ?? null,
        find: () => ({ toArray: async () => orgs }),
      };
    };
    model = {
      findOne: jest.fn(() => ({ lean: () => ({ exec: async () => ({ ...cur }) }) })),
      create: jest.fn(async (d: Record<string, unknown>) => ({ toObject: () => ({ _id: new Types.ObjectId(), ...d }) })),
      updateOne: jest.fn(() => ({ exec: async () => ({ matchedCount: 1 }) })),
      countDocuments: jest.fn(() => ({ exec: async () => 3 })),
      aggregate: jest.fn(() => ({ exec: async () => [{ _id: 'pack1', n: 3 }] })),
    };
    counters = { next: jest.fn(async () => 'КП-2') };
    bgs = { resolve: jest.fn(), defaultTerms: jest.fn(async () => 'Текст новой фирмы.') };
    svc = new OffersService( { db: { collection: coll } } as never, model as never, counters as never, bgs as never, {} as never, {} as never);
  });

  const user = { id: 'u', username: 'm', role: 'manager' } as never;

  it('две фирмы +3 % и +5 %: общий packId, суммы 700400 и 714000, исходное получает packId', async () => {
    const r = await svc.copyMany(String(cur._id), {
      companies: [
        { companyId: String(other), markupPercent: 3 },
        { companyId: String(third), markupPercent: 5 },
      ],
    }, user);
    expect(r.packId).toMatch(/^[a-f0-9]{24}$/);
    expect(model.updateOne).toHaveBeenCalledWith({ _id: cur._id }, { $set: { packId: r.packId } });
    expect(model.create).toHaveBeenCalledTimes(2);
    expect(model.create.mock.calls[0][0].total).toBe(700400);
    expect(model.create.mock.calls[1][0].total).toBe(714000);
    expect(model.create.mock.calls[0][0].packId).toBe(r.packId);
    expect(model.create.mock.calls[1][0].packId).toBe(r.packId);
    expect(model.create.mock.calls[0][0].terms).toBe('Текст новой фирмы.');
    expect(r.items).toHaveLength(2);
  });

  it('повторный пакет: использует уже существующий packId исходного', async () => {
    cur.packId = 'existingpackid0000000001';
    const r = await svc.copyMany(String(cur._id), { companies: [{ companyId: String(other), markupPercent: 0 }] }, user);
    expect(r.packId).toBe('existingpackid0000000001');
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('та же фирма — 400', async () => {
    await expect(svc.copyMany(String(cur._id), { companies: [{ companyId: String(company) }] }, user))
      .rejects.toThrow(BadRequestException);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('повтор фирмы в списке — 400', async () => {
    await expect(svc.copyMany(String(cur._id), {
      companies: [{ companyId: String(other) }, { companyId: String(other), markupPercent: 3 }],
    }, user)).rejects.toThrow(/дважды/);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('нет бланка — 400 с понятным текстом, без создания', async () => {
    blanks = [third];
    await expect(svc.copyMany(String(cur._id), { companies: [{ companyId: String(other) }] }, user))
      .rejects.toThrow(/нет бланка КП/);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('чужая / не наша компания — 400', async () => {
    await expect(svc.copyMany(String(cur._id), { companies: [{ companyId: '5f0000000000000000000000' }] }, user))
      .rejects.toThrow(/нашу компанию/);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('hasBlank: true только у фирм с бланком стр. 1', async () => {
    const r = await svc.companies();
    expect(r.items.find((c) => c.id === String(other))?.hasBlank).toBe(true);
    expect(r.items.find((c) => c.id === String(company))?.hasBlank).toBe(false);
  });
});
