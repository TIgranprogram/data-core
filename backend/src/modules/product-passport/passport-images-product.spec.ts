import { Types } from 'mongoose';
import { ProductPassportService } from './product-passport.service';
import { imageRules } from './passport-rules';

describe('imageRules: правила рисунков по категории', () => {
  const cat = { requiredImages: 'overview\nsafety_zone\nfoundation' };
  it('зона безопасности — только DIO; фундамент — не при анкере', () => {
    expect(imageRules({}, cat, { category: 'DIO', install: 'concrete', variant: 'full' }).required).toEqual(['overview', 'safety_zone', 'foundation']);
    const trn = imageRules({}, cat, { category: 'TRN', install: 'anchor', variant: 'full' });
    expect(trn.required).toEqual(['overview']);
    expect(trn.slots).not.toContain('safety_zone');
    expect(trn.slots).not.toContain('foundation');
  });
  it('при бетонировании фундамент обязателен даже вне справочника; в упрощённом нет «необязательных» видов', () => {
    const r = imageRules({}, { requiredImages: 'overview' }, { category: 'TRN', install: 'concrete', variant: 'short' });
    expect(r.required).toEqual(['overview', 'foundation']);
    expect(r.slots).not.toContain('nameplate');
    expect(imageRules({}, null, { category: 'TRN', variant: 'full' }).slots).toContain('nameplate');
  });
});

describe('рисунки изделия в паспорте (effectiveImages / freezeImages)', () => {
  const productId = new Types.ObjectId();
  const p1 = new Types.ObjectId();
  const own = new Types.ObjectId();
  const make = (rows: unknown[], update = jest.fn()) => {
    const svc = Object.create(ProductPassportService.prototype) as Record<string, unknown>;
    svc.connection = { collection: () => ({ find: () => ({ sort: () => ({ toArray: async () => rows }) }) }) };
    svc.model = { updateOne: (...a: unknown[]) => ({ exec: async () => update(...a) }) };
    svc.oid = (v: unknown) => new Types.ObjectId(String(v));
    return { svc: svc as unknown as ProductPassportService, update };
  };
  const draft = { _id: new Types.ObjectId(), status: 'draft', productId, images: [{ kind: 'overview', photoId: own, order: 0 }, { kind: 'holes', photoId: own, order: 1 }] };

  it('черновик: вид из изделия, остальное из паспорта', async () => {
    const { svc } = make([{ kind: 'overview', photoId: p1, sortOrder: 0 }]);
    const r = await svc.effectiveImages(draft as never);
    expect(r.map((i) => [i.kind, String(i.photoId)])).toEqual([['overview', String(p1)], ['holes', String(own)]]);
  });
  it('выпущенный печатается как раньше — своё images[], изделие не читается', async () => {
    const { svc } = make([{ kind: 'overview', photoId: p1 }]);
    expect(await svc.effectiveImages({ ...draft, status: 'issued' } as never)).toBe(draft.images);
  });
  it('предпросмотр без паспорта: рисунки изделия; изделие без рисунков — пусто', async () => {
    expect((await make([{ kind: 'dimensions', photoId: p1, sortOrder: 0 }]).svc.effectiveImages({ status: 'draft', productId } as never)).map((i) => i.kind)).toEqual(['dimensions']);
    expect(await make([]).svc.effectiveImages({ status: 'draft', productId } as never)).toEqual([]);
  });
  it('выпуск замораживает photoId в images[] черновика', async () => {
    const { svc, update } = make([{ kind: 'overview', photoId: p1, sortOrder: 0 }]);
    (svc as unknown as Record<string, unknown>).findById = async () => ({ toObject: () => draft });
    await svc.freezeImages(String(draft._id));
    const set = (update.mock.calls[0][1] as { $set: { images: Array<{ kind: string; photoId: Types.ObjectId }> } }).$set.images;
    expect(set.map((i) => [i.kind, String(i.photoId)])).toEqual([['overview', String(p1)], ['holes', String(own)]]);
    expect(update.mock.calls[0][0]).toMatchObject({ status: 'draft' });
  });
});
