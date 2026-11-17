import { Types } from 'mongoose';
import { ShowcaseMaterials } from './showcase-materials';

/** «Взять из состава»: прямая труба и труба внутри модуля → детали. */
const fakeDb = (cols: Record<string, Array<Record<string, unknown>>>) => ({
  collection: (name: string) => ({
    findOne: async (q: { _id?: unknown }) => (cols[name] ?? []).find((r) => String(r._id) === String(q._id)) ?? null,
    find: (q: { dict?: string; deletedAt?: unknown; _id?: { $in?: unknown[] } }) => ({
      toArray: async () => (cols[name] ?? []).filter((r) => {
        if (q.dict && r.dict !== q.dict) return false;
        if (q.deletedAt === null && r.deletedAt != null) return false;
        const ids = q._id?.$in;
        if (ids) return ids.some((x) => String(x) === String(r._id));
        return true;
      }),
    }),
  }),
});

describe('materials-spec/from-composition', () => {
  const pipeDict = new Types.ObjectId();
  const post = new Types.ObjectId();
  const dicts = [
    { _id: pipeDict, dict: 'passportMaterials', deletedAt: null, name: 'Труба стальная', code: 'PIPE', kind: 'material', genSingular: 'стальной трубы', sizeTemplate: '{sizes} мм' },
    { _id: post, dict: 'passportParts', deletedAt: null, name: 'Стойка' },
  ];

  it('модуль → деталь → труба даёт строку материала и часть «Стойка», не пустой список', async () => {
    const product = new Types.ObjectId();
    const mod = new Types.ObjectId();
    const part = new Types.ObjectId();
    const pipe = new Types.ObjectId();
    const db = fakeDb({
      products: [{ _id: product, composition: [{ lineType: 'module', refId: mod, quantity: 1 }] }],
      productmodules: [{ _id: mod, name: 'Рама', composition: [{ lineType: 'material', refId: part, quantity: 2 }] }],
      materials: [
        { _id: part, name: 'Стойка', materialKind: 'part', composition: [{ lineType: 'material', refId: pipe, quantity: 1 }] },
        { _id: pipe, name: 'Труба 89х3', materialKind: 'raw' },
      ],
      dict_values: dicts,
    });
    const r = await new ShowcaseMaterials(() => db as never).fromComposition(String(product));
    expect(r.materialsSpec.rows).toEqual([{ materialId: String(pipeDict), sizes: ['∅89×3'], partIds: [String(post)] }]);
    expect(r.unmatched).toEqual([]);
    expect(r.materialsText).toContain('труб');
  });

  it('прямой материал изделия по-прежнему попадает в таблицу', async () => {
    const product = new Types.ObjectId();
    const pipe = new Types.ObjectId();
    const line = new Types.ObjectId();
    const db = fakeDb({
      products: [{ _id: product, composition: [{ _id: line, lineType: 'material', refId: pipe, quantity: 1 }], parts: [{ lineId: line, name: 'Стойки' }] }],
      materials: [{ _id: pipe, name: 'Труба 89х3', materialKind: 'raw' }],
      dict_values: dicts,
    });
    const r = await new ShowcaseMaterials(() => db as never).fromComposition(String(product));
    expect(r.materialsSpec.rows[0]).toMatchObject({ materialId: String(pipeDict), partIds: [String(post)] });
  });

  it('модуль с деталью-material без сырья не даёт пустой список', async () => {
    const product = new Types.ObjectId();
    const mod = new Types.ObjectId();
    const part = new Types.ObjectId();
    const db = fakeDb({
      products: [{ _id: product, composition: [{ lineType: 'module', refId: mod, quantity: 1 }] }],
      productmodules: [{ _id: mod, name: 'Рама', composition: [{ lineType: 'material', refId: part, quantity: 1 }] }],
      materials: [{ _id: part, name: 'Труба 40×20', materialKind: 'part', passportSpec: { materialId: pipeDict, sizes: ['40×20'], isCoating: false } }],
      dict_values: dicts,
    });
    const r = await new ShowcaseMaterials(() => db as never).fromComposition(String(product));
    expect(r.materialsSpec.rows).toEqual([{ materialId: String(pipeDict), sizes: ['40×20'], partIds: [] }]);
    expect(r.unmatched).toEqual([]);
    expect(r).toEqual(expect.objectContaining({ materialsText: expect.any(String) }));
  });

  it('материалы вложенного изделия в таблицу не попадают', async () => {
    const product = new Types.ObjectId();
    const other = new Types.ObjectId();
    const own = new Types.ObjectId();
    const foreign = new Types.ObjectId();
    const db = fakeDb({
      products: [
        { _id: product, composition: [{ lineType: 'material', refId: own, quantity: 1 }, { lineType: 'product', refId: other, quantity: 1 }] },
        { _id: other, name: 'Чужое', composition: [{ lineType: 'material', refId: foreign, quantity: 1 }] },
      ],
      materials: [
        { _id: own, name: 'Труба 89х3', materialKind: 'raw' },
        { _id: foreign, name: 'Лист 2', materialKind: 'raw', passportSpec: { materialId: pipeDict, sizes: ['2'], isCoating: false } },
      ],
      dict_values: dicts,
    });
    const r = await new ShowcaseMaterials(() => db as never).fromComposition(String(product));
    expect(r.materialsSpec.rows).toEqual([{ materialId: String(pipeDict), sizes: ['∅89×3'], partIds: [] }]);
    expect(r.unmatched).toEqual([]);
  });
});
