import { OfferBackgroundsService } from './offer-backgrounds.service';

/** Какой фон берёт PDF (К11): бланк компании важнее общего, выбранный вручную — важнее всех. */
describe('Фон КП по компании', () => {
  const COMPANY = '6ae44ab6e2b85c75e0686864';
  const svc = (docs: Array<{ _id: string; page: number; isDefault: boolean; companyId: string | null; file: string; textTop?: number; textBottom?: number }>) => {
    const model = {
      findById: (id: string) => ({ lean: () => ({ exec: async () => docs.find((d) => d._id === id) ?? null }) }),
      findOne: (q: { page: number; companyId: string | null }) => ({ lean: () => ({ exec: async () => docs.find((d) => d.page === q.page && d.isDefault && d.companyId === q.companyId) ?? null }) }),
    };
    const s = new OfferBackgroundsService(model as never);
    jest.spyOn(s as never, 'jpeg').mockImplementation((async (key: string) => Buffer.from(key)) as never);
    return s;
  };
  const base = [{ _id: 'c'.repeat(24), page: 1, isDefault: true, companyId: null, file: '/uploads/offers/c.png' }];
  const own = { _id: 'a'.repeat(24), page: 1, isDefault: true, companyId: COMPANY, file: '/uploads/offers/a.png' };

  it('бланк компании важнее общего фона', async () => {
    expect(String((await svc([...base, own]).resolve(1, null, COMPANY)).jpeg)).toBe(own._id);
  });
  it('своего бланка нет — общий фон', async () => {
    expect(String((await svc(base).resolve(1, null, COMPANY)).jpeg)).toBe(base[0]._id);
  });
  it('выбранный вручную важнее бланка компании', async () => {
    expect(String((await svc([...base, own]).resolve(1, base[0]._id, COMPANY)).jpeg)).toBe(base[0]._id);
  });
  it('бланк одной компании не достаётся другой', async () => {
    expect(String((await svc([...base, own]).resolve(1, null, 'b'.repeat(24))).jpeg)).toBe(base[0]._id);
  });
  it('зона текста приходит вместе с бланком; у встроенного и у общего без зоны — пусто', async () => {
    const withZone = { ...own, textTop: 0.26, textBottom: 0.78 };
    const r = await svc([...base, withZone]).resolve(1, null, COMPANY);
    expect(r).toMatchObject({ textTop: 0.26, textBottom: 0.78 });
    expect(await svc(base).resolve(1, null, COMPANY)).toMatchObject({ textTop: null, textBottom: null });
  });
});
