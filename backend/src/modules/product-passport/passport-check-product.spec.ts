import { Types } from 'mongoose';
import { ProductPassportService } from './product-passport.service';
import * as fp from './passport-from-product';

/** POST /passports/check с productId: поля берутся из изделия, шаблон не требует полей экземпляра, у пунктов есть hint. */
describe('ProductPassportService.check с изделием', () => {
  const productId = new Types.ObjectId();
  const make = () => {
    const svc = Object.create(ProductPassportService.prototype) as Record<string, unknown>;
    svc.connection = { db: {}, collection: () => ({ findOne: async () => ({ _id: productId }) }) };
    svc.productImageRows = async () => [];
    svc.categoryRules = async () => new Map();
    svc.installs = async () => new Map();
    svc.choiceMissing = async () => [];
    return svc as unknown as ProductPassportService;
  };
  beforeEach(() => { jest.spyOn(fp, 'productPatch').mockResolvedValue({ name: 'Велотренажёр', length: 1694, width: 1300, height: 1130, weight: 80 }); });

  it('габариты и вес из изделия — в missing их нет, хотя тело их не прислало', async () => {
    const r = await make().check({ productId: String(productId), passportDefaults: { maxUsers: 1 } });
    const labels = r.missing.map((m) => m.label);
    expect(labels).not.toContain('Габариты');
    expect(labels).not.toContain('Вес');
    expect(labels).toContain('Материалы');
  });
  it('mode template (по умолчанию при изделии) — без даты и поставщика; instance — с ними', async () => {
    const t = await make().check({ productId: String(productId) });
    expect(t.mode).toBe('template');
    expect(t.missing.map((m) => m.label)).not.toContain('Дата');
    expect(t.missing.map((m) => m.label)).not.toContain('Поставщик');
    const i = await make().check({ productId: String(productId), mode: 'instance' });
    expect(i.missing.map((m) => m.label)).toEqual(expect.arrayContaining(['Дата', 'Поставщик']));
  });
  it('у каждого пункта своя подсказка', async () => {
    const r = await make().check({ productId: String(productId), mode: 'instance' });
    expect(r.missing.every((m) => !!m.hint)).toBe(true);
    expect(new Set(r.missing.map((m) => m.hint)).size).toBeGreaterThan(3);
    expect(r.missing.find((m) => m.label === 'Материалы')?.hint).toMatch(/Карточка изделия/);
  });
  it('без изделия — как раньше (mode instance)', async () => {
    expect((await make().check({ name: 'X' })).mode).toBe('instance');
  });
});
