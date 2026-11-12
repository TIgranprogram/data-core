import { Types } from 'mongoose';
import { SupplierCatalogService, materialRow } from './supplier-catalog.service';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const id = () => new Types.ObjectId();

/** Мини-база: find/aggregate/distinct/countDocuments возвращают заготовленное и запоминают вызовы. */
function fake(data: Record<string, Doc[]>, aggregated: Doc[] = []) {
  const calls: { coll: string; op: string; arg: unknown }[] = [];
  const cur = (rows: Doc[]) => { const c: Doc = { sort: () => c, skip: () => c, limit: () => c, toArray: async () => rows }; return c; };
  const coll = (n: string) => ({
    find: (f: unknown) => { calls.push({ coll: n, op: 'find', arg: f }); return cur(data[n] ?? []); },
    countDocuments: async (f: unknown) => { calls.push({ coll: n, op: 'count', arg: f }); return (data[n] ?? []).length; },
    findOne: async (f: Doc) => { calls.push({ coll: n, op: 'findOne', arg: f }); return (data[n] ?? []).find((d) => String(d._id) === String(f._id)) ?? null; },
    distinct: async () => (data[n] ?? []).map((d) => d.materialId).filter(Boolean),
    aggregate: (p: unknown) => { calls.push({ coll: n, op: 'aggregate', arg: p }); return { toArray: async () => (n === 'supplieritems' ? aggregated : []) }; },
  });
  const svc = new SupplierCatalogService({ db: { collection: coll } } as never);
  return { svc, calls };
}

describe('каталог: view=all', () => {
  const mat = { _id: id(), name: 'Труба 20', article: 'T-20', unit: 'м', categoryId: id(), stockQty: 5 };

  it('строка материала: поставщика нет, цены нет, id с префиксом m:', () => {
    const r = materialRow(mat, 3);
    expect(r).toMatchObject({ id: 'm:' + mat._id, kind: 'material', materialId: String(mat._id), supplierId: null, supplierName: '', priceHint: null, priceDate: null, stockQty: 3, photos: [], thumb: '', priceHistory: [] });
    expect(r.name).toBe('Труба 20');
  });

  it('открыть строку материала по прямой ссылке: get("m:<id>") → та же строка, не 400', async () => {
    const { svc } = fake({ materials: [mat] });
    const r = await svc.get('m:' + mat._id);
    expect(r).toMatchObject({ id: 'm:' + mat._id, kind: 'material', materialId: String(mat._id), name: 'Труба 20' });
    await expect(svc.get('m:' + id())).rejects.toThrow(/не найдена/);
  });

  it('строка материала показывает фото самой позиции склада', async () => {
    const p = id();
    const { svc } = fake({ materials: [{ ...mat, photoIds: [p] }], photos: [{ _id: p, storageUrl: '/uploads/a.jpg' }] });
    const r = await svc.get('m:' + mat._id);
    expect(r.photos).toHaveLength(1);
    expect(r.photos[0].id).toBe(String(p));
  });

  it('без view — прежний путь: только предложения, без kind', async () => {
    const offer = { _id: id(), supplierId: id(), name: 'Труба', article: 'A', materialId: null, priceHint: 10, deletedAt: null };
    const { svc, calls } = fake({ supplieritems: [offer] });
    const r = await svc.list({});
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).not.toHaveProperty('kind');
    expect(calls.some((c) => c.op === 'aggregate' && c.coll === 'supplieritems' && JSON.stringify(c.arg).includes('$unionWith'))).toBe(false);
  });

  it('view=all: $unionWith по materials, total из $facet, материал без предложения в списке', async () => {
    const offer = { _id: id(), supplierId: id(), name: 'Лист', article: 'L', materialId: null, priceHint: 5, deletedAt: null };
    const { svc, calls } = fake(
      { supplieritems: [offer], materials: [mat] },
      [{ rows: [{ _id: offer._id, k: 'o' }, { _id: mat._id, k: 'm' }], total: [{ n: 2 }] }],
    );
    const r = await svc.list({ view: 'all' });
    expect(r.total).toBe(2);
    expect((r.items as Doc[]).map((x: Doc) => x.kind)).toEqual(['offer', 'material']);
    expect(r.items[1]).toMatchObject({ id: 'm:' + mat._id, supplierId: null });
    const pipe = JSON.stringify(calls.find((c) => c.op === 'aggregate' && c.coll === 'supplieritems')!.arg);
    expect(pipe).toContain('$unionWith');
    expect(pipe).toContain('"coll":"materials"');
  });

  it('view=all&supplierId=none: только материалы без предложений', async () => {
    const { svc, calls } = fake({ supplieritems: [], materials: [mat] });
    const r = await svc.list({ view: 'all', supplierId: 'none' });
    expect(r.total).toBe(1);
    expect((r.items as Doc[]).every((x: Doc) => x.kind === 'material')).toBe(true);
    expect(calls.some((c) => c.coll === 'supplieritems' && c.op === 'find')).toBe(false);
  });

  it('view=all&unmatched=1: материалы не показываются, kind=offer', async () => {
    const offer = { _id: id(), supplierId: id(), name: 'Лист', article: 'L', materialId: null, deletedAt: null };
    const { svc, calls } = fake({ supplieritems: [offer], materials: [mat] });
    const r = await svc.list({ view: 'all', unmatched: '1' });
    expect((r.items as Doc[]).map((x: Doc) => x.kind)).toEqual(['offer']);
    expect(calls.some((c) => c.coll === 'materials' && c.op === 'find')).toBe(false);
  });

  it('C057: материалы без withParts — без деталей PDM и сортаментов; withParts=1 — все', async () => {
    const hidden = (c: { coll: string; op: string; arg: unknown }) => c.coll === 'materials' && c.op === 'find' && JSON.stringify(c.arg).includes('"materialKind":{"$ne":"part"}') && JSON.stringify(c.arg).includes('"isProfile":{"$ne":true}');
    const a = fake({ supplieritems: [], materials: [mat] });
    await a.svc.list({ view: 'all', supplierId: 'none' });
    expect(a.calls.some(hidden)).toBe(true);
    const b = fake({ supplieritems: [], materials: [mat] });
    await b.svc.list({ view: 'all', supplierId: 'none', withParts: '1' });
    expect(b.calls.some((c) => c.coll === 'materials' && c.op === 'find')).toBe(true);
    expect(b.calls.some(hidden)).toBe(false);
  });
});

describe('каталог: поиск по названию категории (AIT-6)', () => {
  const top = { _id: id(), name: 'Метизы', parentId: null };
  const sub = { _id: id(), name: 'Болты', parentId: top._id };
  const other = { _id: id(), name: 'Расходники', parentId: null };
  const orOf = (calls: { coll: string; op: string; arg: unknown }[]) => (calls.find((c) => c.coll === 'supplieritems' && c.op === 'find')!.arg as Doc).$or as Doc[];

  it('слово совпало с категорией — в условие входят она и её подкатегории', async () => {
    const { svc, calls } = fake({ categories: [top, sub, other], supplieritems: [] });
    await svc.list({ search: 'метиз' });
    const cat = orOf(calls).find((x) => x.categoryId)!;
    expect(cat.categoryId.$in.map(String).sort()).toEqual([String(top._id), String(sub._id)].sort());
    expect(orOf(calls)).toHaveLength(4); // название, артикул, примечание, категория
  });

  it('категории с таким словом нет — поиск как раньше, без условия по категории', async () => {
    const { svc, calls } = fake({ categories: [top, sub, other], supplieritems: [] });
    await svc.list({ search: 'труба' });
    expect(orOf(calls).some((x) => x.categoryId)).toBe(false);
    expect(orOf(calls)).toHaveLength(3);
  });
});
