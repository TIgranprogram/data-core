import { Types } from 'mongoose';
import { DICT, type Doc } from './dicts.defs';

/** МИ.1b: «Сортамент», «Части изделия», «Материалы и покрытия» — «Используется» в изделиях (`products.materialsSpec`). */
type Row = Record<string, unknown>;
const eq = (a: unknown, b: unknown) => String(a) === String(b);
// значения по пути с точками; массивы по дороге раскрываются (как в Mongo)
const at = (r: unknown, path: string[]): unknown[] => {
  if (!path.length) return Array.isArray(r) ? r : [r];
  if (Array.isArray(r)) return r.flatMap((x) => at(x, path));
  return r && typeof r === 'object' ? at((r as Row)[path[0]], path.slice(1)) : [];
};
function match(r: Row, q: Row): boolean {
  return Object.entries(q).every(([k, v]) => {
    if (k === '$or') return (v as Row[]).some((x) => match(r, x));
    if (k === '$and') return (v as Row[]).every((x) => match(r, x));
    const vals = at(r, k.split('.'));
    if (v === null) return vals.every((x) => x == null);
    if (v && typeof v === 'object' && !(v instanceof Types.ObjectId)) {
      const o = v as Row;
      if ('$elemMatch' in o) return vals.some((x) => match(x as Row, o.$elemMatch as Row));
      if ('$in' in o) return vals.some((x) => (o.$in as unknown[]).some((y) => eq(x, y)));
      if ('$nin' in o) return !vals.some((x) => (o.$nin as unknown[]).some((y) => (y == null ? x == null : eq(x, y))));
      if ('$ne' in o) return !vals.some((x) => eq(x, o.$ne));
    }
    return vals.some((x) => eq(x, v));
  });
}
function fakeDb(data: Record<string, Row[]>) {
  return {
    collection: (name: string) => {
      const rows = () => data[name] ?? [];
      const cursor = (q: Row) => { const list = rows().filter((r) => match(r, q)); const c = { sort: () => c, limit: () => c, project: () => c, toArray: async () => list }; return c; };
      return { find: cursor, findOne: async (q: Row) => rows().find((r) => match(r, q)) ?? null, countDocuments: async (q: Row) => rows().filter((r) => match(r, q)).length };
    },
  } as never;
}
const id = () => new Types.ObjectId();

describe('справочники МИ: где используется в изделиях', () => {
  const pipe = { _id: id(), dict: 'passportMaterials', code: 'PIPE_STEEL', name: 'Труба стальная', deletedAt: null };
  const powder = { _id: id(), dict: 'passportMaterials', code: 'COAT_POWDER', name: 'Порошковая окраска', kind: 'coating', deletedAt: null };
  const s89 = { _id: id(), dict: 'passportSortament', material: 'PIPE_STEEL', name: '∅89×3', deletedAt: null };
  const s57 = { _id: id(), dict: 'passportSortament', material: 'PIPE_STEEL', name: '∅57×3', deletedAt: null };
  const post = { _id: id(), dict: 'passportParts', name: 'Стойка', deletedAt: null };
  const clamp = { _id: id(), dict: 'passportParts', name: 'Хомут', deletedAt: null };
  const db = fakeDb({
    dict_values: [pipe, powder, s89, s57, post, clamp],
    products: [
      { _id: id(), name: 'Турник', materialsSpec: { rows: [{ materialId: pipe._id, sizes: ['∅89×3'], partIds: [post._id] }], coatingIds: [powder._id] }, deletedAt: null },
      { _id: id(), name: 'Брусья', materialsSpec: { rows: [{ materialId: pipe._id, sizes: ['∅89×3'], partIds: [] }], coatingIds: [] }, deletedAt: null },
      { _id: id(), name: 'Удалённое', materialsSpec: { rows: [{ materialId: pipe._id, sizes: ['∅57×3'], partIds: [clamp._id] }] }, deletedAt: new Date() },
    ],
    productpassports: [],
  });
  const used = async (key: string, docs: Row[]) => DICT.get(key)!.usage(db, docs as unknown as Doc[]);

  it('материал и покрытие: изделия + записи «Сортамента» с его кодом', async () => {
    const m = await used('passportMaterials', [pipe, powder]);
    expect(m.get(String(pipe._id))).toBe(4); // 2 живых изделия + 2 размера сортамента
    expect(m.get(String(powder._id))).toBe(1);
    const rel = await DICT.get('passportMaterials')!.related(db, pipe as unknown as Doc);
    expect(rel.items.map((x) => x.label)).toEqual(expect.arrayContaining(['Сортамент: ∅89×3', 'Изделие Турник', 'Изделие Брусья']));
  });
  it('размер сортамента — изделия с этим материалом и размером; часть — изделия, где она в строке; удалённые не считаются', async () => {
    const s = await used('passportSortament', [s89, s57]);
    expect(s.get(String(s89._id))).toBe(2);
    expect(s.get(String(s57._id))).toBe(0);
    const p = await used('passportParts', [post, clamp]);
    expect(p.get(String(post._id))).toBe(1);
    expect(p.get(String(clamp._id))).toBe(0);
  });
  it('сортамент: дубль — материал + размер одним написанием; код материала проверяется', async () => {
    const d = DICT.get('passportSortament')!;
    expect(d.dupKey!({ material: 'pipe_steel', name: 'Ø89x3' } as unknown as Doc)).toBe(d.dupKey!(s89 as unknown as Doc));
    expect(d.dupKey!({ material: 'SHEET_STEEL', name: '∅89×3' } as unknown as Doc)).not.toBe(d.dupKey!(s89 as unknown as Doc));
    expect(await d.toDoc({ name: 'Ø 33.5x2.8 мм', material: 'pipe_steel' }, true, db)).toMatchObject({ dict: 'passportSortament', name: '∅33,5×2,8', material: 'PIPE_STEEL' });
    await expect(d.toDoc({ name: '2', material: 'NOPE' }, true, db)).rejects.toThrow('Нет материала с кодом NOPE');
  });
  it('новые справочники — в группе «Паспорта», правят директор и админ', () => {
    for (const k of ['passportSortament', 'passportParts']) {
      expect(DICT.get(k)!.group).toBe('Паспорта');
      expect(DICT.get(k)!.editRoles).toEqual(['director']);
    }
    expect(DICT.get('passportMaterials')!.fields.map((f) => f.key)).toEqual(expect.arrayContaining(['kind', 'genSingular', 'genPlural', 'sizeTemplate', 'phrase']));
  });
});
