import { Types } from 'mongoose';
import { expandComposition, sheetRows, stockRefs, visibleSheet, type CompNode } from './composition-expand';

const id = () => new Types.ObjectId();
const node = (row: CompNode): [string, CompNode] => [row.id, row];

describe('лист состава', () => {
  it('модуль показывает деталь под собой; нет имени — обозначение', () => {
    const mod = String(id());
    const part = String(id());
    const nodes = new Map<string, CompNode>([
      node({ id: mod, name: '', code: 'М-1', composition: [{ lineType: 'material', refId: part, quantity: 2 }] }),
      node({ id: part, name: 'Стойка', materialKind: 'part' }),
    ]);
    expect(sheetRows([{ lineType: 'module', refId: mod, quantity: 1, unit: 'шт' }], nodes)).toEqual([{
      kind: 'module', word: 'Модуль', label: 'М-1', qty: 1, unit: 'шт',
      children: [{ kind: 'part', word: 'Деталь', label: 'Стойка', qty: 2, unit: 'шт' }],
    }]);
  });

  it('деталь модуля не становится отдельной строкой изделия', () => {
    const mod = String(id());
    const part = String(id());
    const nodes = new Map<string, CompNode>([
      node({ id: mod, name: 'Рама', composition: [{ lineType: 'material', refId: part, quantity: 1 }] }),
      node({ id: part, name: 'Стойка', materialKind: 'part' }),
    ]);
    const rows = sheetRows([{ lineType: 'module', refId: mod, quantity: 1 }], nodes);
    expect(rows).toHaveLength(1);
    expect(rows[0].children?.map((c) => c.label)).toEqual(['Стойка']);
  });

  it('цикл модуля не зацикливает лист', () => {
    const mod = String(id());
    const nodes = new Map<string, CompNode>([
      node({ id: mod, name: 'Рама', composition: [{ lineType: 'module', refId: mod, quantity: 1 }] }),
    ]);
    expect(sheetRows([{ lineType: 'module', refId: mod, quantity: 1 }], nodes)[0].children).toBeUndefined();
  });
});

describe('позиции склада по цепочке', () => {
  it('модуль → деталь → сырьё: в таблицу идёт труба, имя детали — часть', () => {
    const mod = String(id());
    const part = String(id());
    const pipe = String(id());
    const nodes = new Map<string, CompNode>([
      node({ id: mod, name: 'Рама', composition: [{ lineType: 'material', refId: part, quantity: 2 }] }),
      node({ id: part, name: 'Стойка', materialKind: 'part', composition: [{ lineType: 'material', refId: pipe, quantity: 1 }] }),
      node({ id: pipe, name: 'Труба 89х3', materialKind: 'raw' }),
    ]);
    expect(stockRefs([{ lineType: 'module', refId: mod, quantity: 1 }], nodes)).toEqual([{ id: pipe, partNames: ['Стойка'] }]);
  });

  it('прямой материал изделия остаётся; пустой состав модуля берёт старый список', () => {
    const bolt = String(id());
    const mod = String(id());
    const pipe = String(id());
    const nodes = new Map<string, CompNode>([
      node({ id: bolt, name: 'Болт', materialKind: 'fastener' }),
      node({ id: mod, name: 'Рама', materials: [{ materialId: pipe, quantity: 1 }] }),
      node({ id: pipe, name: 'Труба', materialKind: 'raw' }),
    ]);
    expect(stockRefs([
      { lineType: 'material', refId: bolt, quantity: 4 },
      { lineType: 'module', refId: mod, quantity: 1 },
    ], nodes).map((r) => r.id)).toEqual([bolt, pipe]);
  });

  it('старые productModuleIds, если своего состава нет', () => {
    const mod = String(id());
    const pipe = String(id());
    const nodes = new Map<string, CompNode>([
      node({ id: mod, name: 'Рама', composition: [{ lineType: 'material', refId: pipe, quantity: 1 }] }),
      node({ id: pipe, name: 'Труба', materialKind: 'raw' }),
    ]);
    expect(stockRefs([], nodes, [mod])).toEqual([{ id: pipe, partNames: [] }]);
  });

  it('деталь без своего состава остаётся — модуль не даёт пустой список', () => {
    const mod = String(id());
    const part = String(id());
    const nodes = new Map<string, CompNode>([
      node({ id: mod, name: 'Рама', composition: [{ lineType: 'material', refId: part, quantity: 1 }] }),
      node({ id: part, name: 'Стойка', materialKind: 'part' }),
    ]);
    expect(stockRefs([{ lineType: 'module', refId: mod, quantity: 1 }], nodes)).toEqual([{ id: part, partNames: [] }]);
  });

  it('вложенный модуль доходит до материала; чужое изделие не раскрывается', () => {
    const outer = String(id());
    const inner = String(id());
    const pipe = String(id());
    const other = String(id());
    const foreign = String(id());
    const nodes = new Map<string, CompNode>([
      node({ id: outer, name: 'Каркас', composition: [{ lineType: 'module', refId: inner, quantity: 1 }, { lineType: 'product', refId: other, quantity: 1 }] }),
      node({ id: inner, name: 'Рама', composition: [{ lineType: 'material', refId: pipe, quantity: 1 }] }),
      node({ id: pipe, name: 'Труба', materialKind: 'raw' }),
      node({ id: other, name: 'Чужое', composition: [{ lineType: 'material', refId: foreign, quantity: 1 }] }),
      node({ id: foreign, name: 'Чужой лист', materialKind: 'raw' }),
    ]);
    expect(stockRefs([{ lineType: 'module', refId: outer, quantity: 1 }], nodes).map((r) => r.id)).toEqual([pipe]);
  });
});

describe('expandComposition', () => {
  const fake = (cols: Record<string, Array<Record<string, unknown>>>) => ({
    collection: (name: string) => ({
      find: (q: { _id?: { $in?: unknown[] } }) => ({
        toArray: async () => {
          const ids = q._id?.$in;
          return (cols[name] ?? []).filter((r) => !ids || ids.some((x) => String(x) === String(r._id)));
        },
      }),
    }),
  });

  it('дочитывает модуль и деталь и не тащит сырьё на лист изделия', async () => {
    const mod = id();
    const part = id();
    const pipe = id();
    const graph = await expandComposition(fake({
      productmodules: [{ _id: mod, sku: 'М-1', composition: [{ lineType: 'material', refId: part, quantity: 2 }] }],
      materials: [
        { _id: part, name: 'Стойка', materialKind: 'part', composition: [{ lineType: 'material', refId: pipe, quantity: 1 }] },
        { _id: pipe, name: 'Труба 89х3', materialKind: 'raw' },
      ],
    }), { composition: [{ lineType: 'module', refId: mod, quantity: 1 }] });
    expect(graph.sheet.map((r) => r.label)).toEqual(['М-1']);
    expect(graph.sheet[0].children?.map((r) => r.word)).toEqual(['Деталь']);
    expect(graph.stock).toEqual([{ id: String(pipe), partNames: ['Стойка'] }]);
    expect(graph.materials.get(String(pipe))?.name).toBe('Труба 89х3');
  });

  it('состав вложенного изделия не читает его материалы', async () => {
    const other = id();
    const foreign = id();
    const calls: string[] = [];
    const graph = await expandComposition({
      collection: (name: string) => ({
        find: (q: { _id?: { $in?: unknown[] } }) => ({
          toArray: async () => {
            calls.push(name);
            const ids = q._id?.$in;
            const rows = name === 'products' ? [{ _id: other, name: 'Чужое', composition: [{ lineType: 'material', refId: foreign, quantity: 1 }] }] : [];
            return rows.filter((r) => !ids || ids.some((x) => String(x) === String(r._id)));
          },
        }),
      }),
    }, { composition: [{ lineType: 'product', refId: other, quantity: 1 }] });
    expect(graph.stock).toEqual([]);
    expect(graph.sheet.map((r) => r.label)).toEqual(['Чужое']);
    expect(graph.sheet[0].children).toBeUndefined();
    expect(calls).toEqual(['products']);
  });
});

describe('visibleSheet', () => {
  it('выбрасывает пустые строки и оставляет вложенные', () => {
    expect(visibleSheet([{ word: 'Модуль', label: 'Рама', qty: 1, children: [{ word: 'Деталь', label: '', qty: 2 }, { word: 'Деталь', label: 'Стойка', qty: 2 }] }])).toEqual([
      { kind: 'material', word: 'Модуль', label: 'Рама', qty: 1, unit: 'шт', children: [{ kind: 'material', word: 'Деталь', label: 'Стойка', qty: 2, unit: 'шт' }] },
    ]);
    expect(visibleSheet(null)).toEqual([]);
  });
});
