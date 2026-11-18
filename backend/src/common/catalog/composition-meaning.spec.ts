import { Types } from 'mongoose';
import { stockRefs, sheetRows, type CompNode } from './composition-expand';
import { specFromComposition } from './materials-text';
import { parseMaterialsSpec, presentMaterialsSpec } from './materials-table';
import { techSheetRows } from '../print/tech-sheet-rows';
import { parseSourceRefs } from './material-source-refs';

const id = () => String(new Types.ObjectId());
it('C148: одинаковые названия разных деталей сохраняют пути через предложение, запись и печать', () => {
  const mod = id(), a = id(), b = id(), raw = id(), mat = id();
  const nodes = new Map<string, CompNode>([
    [mod, { id: mod, name: 'Рама', composition: [a, b].map((refId) => ({ lineType: 'material', refId, quantity: 3 })) }],
    ...[a, b].map((refId) => [refId, { id: refId, name: 'Стойка', code: refId === a ? 'СТ.1' : 'СТ.2', materialKind: 'part', composition: [{ lineType: 'material', refId: raw, quantity: 1 }] }] as [string, CompNode]),
    [raw, { id: raw, name: 'Труба', materialKind: 'raw' }],
  ]);
  const root = [{ lineType: 'module', refId: mod, quantity: 2 }];
  const sheet = sheetRows(root, nodes);
  expect(sheet[0].qty * sheet[0].children![0].qty).toBe(6);
  const stock = stockRefs(root, nodes);
  expect(stock[0].sourceRefs.map((r) => r.refId)).toEqual([a, b]);
  expect(stock[0].sourceRefs[0].path.map((r) => r.refId)).toEqual([mod, a, raw]);
  const proposal = specFromComposition([{ name: 'Труба', text: 'Труба', sourceRefs: stock[0].sourceRefs, link: { materialId: mat, sizes: ['89×3'], isCoating: false, passportText: 'Ручной паспорт', techText: 'Ручная техника' } }], [{ id: mat, name: 'Труба' }], []);
  const saved = presentMaterialsSpec(parseMaterialsSpec(proposal))!;
  expect(saved.rows[0].partIds).toEqual([]);
  expect(saved.rows[0].sourceRefs).toEqual(stock[0].sourceRefs);
  expect(saved.rows[0].passportText).toBe('Ручной паспорт');
  const printed = techSheetRows({ spec: saved, mats: [{ id: mat, name: 'Сталь' }], parts: [] });
  expect(printed[0]).toEqual({ name: 'Стойка СТ.1, Стойка СТ.2', text: 'Ручная техника' });
  const missing = specFromComposition([{ name: 'Неизвестное сырьё', text: '?', sourceRefs: stock[0].sourceRefs }], [], []);
  expect(missing.unmatched).toEqual(['Неизвестное сырьё']);
  expect(missing.unmatchedSources[0].sourceRefs).toEqual(stock[0].sourceRefs);
  expect(missing.rows).toEqual([]);
});

it('C148: источники ограничены и нормализуются без потери ручного старого формата', () => {
  const ref = { kind: 'part', refId: id(), name: ' Стойка ', code: ' СТ ' };
  const row = { ...ref, path: [ref] };
  expect(parseSourceRefs([row, row])).toHaveLength(1);
  expect(() => parseSourceRefs([{ ...row, path: Array(11).fill(ref) }])).toThrow('Путь источника');
  expect(() => parseSourceRefs([{ ...row, refId: 'ошибка' }])).toThrow('ссылка');
  expect(() => parseSourceRefs(Array(101).fill(row))).toThrow('до 100');
  expect(presentMaterialsSpec(parseMaterialsSpec({ rows: [{ materialId: id(), sizes: [], partIds: [] }], coatingIds: [] }))!.rows[0]).not.toHaveProperty('sourceRefs');
});

it('C148: 101 деталь одного материала дробится на сохраняемые строки без потери источников', () => {
  const mat = id();
  const refs = Array.from({ length: 101 }, (_, i) => {
    const ref = { kind: 'part' as const, refId: id(), name: 'Стойка', code: `СТ.${i}` };
    return { ...ref, path: [ref] };
  });
  const proposal = specFromComposition(refs.map((ref) => ({ name: ref.name, text: '', sourceRefs: [ref], link: { materialId: mat, sizes: [], isCoating: false } })), [{ id: mat, name: 'Сталь' }], []);
  expect(proposal.rows.map((r) => r.sourceRefs?.length)).toEqual([100, 1]);
  const saved = presentMaterialsSpec(parseMaterialsSpec(proposal))!;
  expect(saved.rows.flatMap((r) => r.sourceRefs ?? [])).toEqual(refs);
  expect(() => specFromComposition(Array.from({ length: 51 }, () => ({ name: 'Материал', text: '', link: { materialId: mat, sizes: [], isCoating: false, passportText: id() } })), [{ id: mat, name: 'Сталь' }], [])).toThrow('больше 50');
});

it('C148: крайняя разрешённая глубина дерева укладывается в сохраняемый путь источника', () => {
  const chain = Array.from({ length: 9 }, id);
  const nodes = new Map<string, CompNode>(chain.map((refId, i) => [refId, {
    id: refId, name: `Узел ${i}`, materialKind: i === 7 ? 'part' : 'raw',
    ...(i < 8 ? { composition: [{ lineType: i < 6 ? 'module' : 'material', refId: chain[i + 1], quantity: 1 }] } : {}),
  }]));
  const stock = stockRefs([{ lineType: 'module', refId: chain[0], quantity: 1 }], nodes);
  expect(stock[0].sourceRefs[0].path).toHaveLength(9);
  expect(parseSourceRefs(stock[0].sourceRefs)).toEqual(stock[0].sourceRefs);
});
