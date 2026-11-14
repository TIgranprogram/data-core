import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProductPassportService } from './product-passport.service';

/** МИ: `productpassports.materialsSpec` — таблица паспорта (снимок изделия с правкой): разбор, ссылки, замок выпущенного. */
const id = () => new Types.ObjectId();
const pipe = id(), post = id(), gone = id();
const live = [{ _id: pipe, dict: 'passportMaterials' }, { _id: post, dict: 'passportParts' }];
const collection = () => ({ find: (q: { dict: string; _id: { $in: Types.ObjectId[] } }) => ({ toArray: async () => live.filter((x) => x.dict === q.dict && q._id.$in.some((i) => i.equals(x._id))) }), findOne: async () => null });
const db = { collection };

/** Паспорт в «базе»: findById → документ с set/save; create → то, что записали. */
function make(cur: Record<string, unknown>) {
  const state = { ...cur };
  const doc = { _id: cur._id, toObject: () => ({ ...state }), set: (s: Record<string, unknown>) => Object.assign(state, s), save: async () => doc, get passportCategory() { return state.passportCategory; } };
  const chain = (v: unknown) => ({ setOptions: () => chain(v), select: () => chain(v), lean: () => chain(v), exec: async () => v });
  const created: Record<string, unknown>[] = [];
  const model = { findById: () => chain(doc), findOne: () => chain(null), create: async (s: Record<string, unknown>) => { created.push(s); return s; } };
  const svc = new ProductPassportService(model as never, {} as never, { db, collection } as never);
  return { svc, state, created };
}
const spec = (materialId: Types.ObjectId, partIds: Types.ObjectId[] = []) => ({ rows: [{ materialId: String(materialId), sizes: ['Ø89x3'], partIds: partIds.map(String) }], coatingIds: [] });

describe('materialsSpec паспорта', () => {
  it('создание: тот же разбор, что у изделия (одно написание размера, ObjectId)', async () => {
    const { svc, created } = make({});
    await svc.create({ name: 'Турник', productId: String(id()), supplierOrgId: String(id()), materialsSpec: spec(pipe, [post]) } as never);
    const sp = created[0].materialsSpec as { rows: { materialId: Types.ObjectId; sizes: string[]; partIds: Types.ObjectId[] }[] };
    expect(sp.rows[0].materialId.equals(pipe)).toBe(true);
    expect(sp.rows[0].sizes).toEqual(['∅89×3']);
    expect(sp.rows[0].partIds[0].equals(post)).toBe(true);
  });
  it('создание: ссылка не из справочника — 400', async () => {
    const { svc } = make({});
    const bound = { productId: String(id()), supplierOrgId: String(id()) };
    await expect(svc.create({ ...bound, materialsSpec: spec(gone) } as never)).rejects.toThrow('«Материалы и покрытия»');
    await expect(svc.create({ ...bound, materialsSpec: { rows: [{ sizes: ['2'] }] } } as never)).rejects.toThrow(BadRequestException);
  });
  it('черновик: таблицу можно сменить и снять (null); прежняя с записью из корзины не мешает сохранить другое', async () => {
    const { svc, state } = make({ _id: id(), status: 'draft', passportNumber: 'draft-x', materialsSpec: { rows: [{ materialId: gone, sizes: [], partIds: [] }], coatingIds: [] } });
    await svc.update(String(state._id), { name: 'Новое имя', materialsSpec: { rows: [{ materialId: String(gone) }], coatingIds: [] } } as never);
    expect(state.name).toBe('Новое имя');
    await svc.update(String(state._id), { materialsSpec: spec(pipe) } as never);
    expect((state.materialsSpec as { rows: { sizes: string[] }[] }).rows[0].sizes).toEqual(['∅89×3']);
    await svc.update(String(state._id), { materialsSpec: null } as never);
    expect(state.materialsSpec).toBeNull();
  });
  it('выпущенный: таблица меняется свободно, номер тот же, прежняя — в истории (2026-11-14)', async () => {
    const old = { rows: [{ materialId: pipe, sizes: ['∅89×3'], partIds: [] }], coatingIds: [] };
    const { svc, state } = make({ _id: id(), status: 'issued', passportNumber: '100', revision: 1, materialsSpec: old });
    // та же таблица (клиент прислал как есть) — не изменение
    await expect(svc.update(String(state._id), { materialsSpec: { rows: [{ materialId: String(pipe), sizes: ['∅89×3'] }] }, note: 'после печати' } as never)).resolves.toBeDefined();
    await svc.update(String(state._id), { materialsSpec: spec(pipe, [post]) } as never);
    expect(state.passportNumber).toBe('100');
    expect(state.revision).toBe(2);
    expect((state.revisions as { data: Record<string, unknown> }[])[0].data.materialsSpec).toEqual(old);
    expect((state.materialsSpec as { rows: { partIds: Types.ObjectId[] }[] }).rows[0].partIds[0].equals(post)).toBe(true);
  });
});
