import { Types } from 'mongoose';
import type { PdmTreeDto } from './dto/pdm-tree.dto';
import { buildPlan, exactHit, pdmKey, siteKey, type Lookup, type SiteDoc } from './pdm-plan-rows';
import { miniTree } from './pdm-tree.testkit';

const empty = (): Lookup => ({ materials: [], modules: [], products: [], profiles: [], byKey: new Map() });
const doc = (extra: Partial<SiteDoc>): SiteDoc => ({ _id: new Types.ObjectId(), updatedAt: new Date('2026-11-01'), ...extra });
const rowOf = (plan: ReturnType<typeof buildPlan>, d: string) => plan.rows.find((r) => r.designation === d)!;
const tree = (): PdmTreeDto => JSON.parse(JSON.stringify(miniTree()));

describe('план загрузки', () => {
  it('на пустом сайте всё создаётся, сортаментов два (лист 4 мм и фанера)', () => {
    const plan = buildPlan(tree(), empty());
    expect(plan.rows.every((r) => r.action === 'create')).toBe(true);
    expect(plan.raws.map((r) => [r.unit, r.action])).toEqual([['м²', 'create'], ['м²', 'create']]);
    expect(plan.blockers).toEqual([]);
    expect(plan.found).toEqual([]);
  });

  it('деталь, модуль и изделие ищутся по точному обозначению, удалённые тоже', () => {
    const part = doc({ article: '0000.1005.0001', materialKind: 'part', deletedAt: new Date('2026-10-01') });
    const mod = doc({ article: '0000.1005.0000' }), prod = doc({ sku: '6104.0000.0000' });
    const plan = buildPlan(tree(), { ...empty(), materials: [part], modules: [mod], products: [prod] });
    expect(rowOf(plan, '0000.1005.0001')).toMatchObject({ action: 'link', by: 'article', deleted: true, targetId: String(part._id) });
    expect(rowOf(plan, '0000.1005.0000')).toMatchObject({ action: 'link', targetId: String(mod._id) });
    expect(rowOf(plan, '6104.0000.0000').targetId).toBe(String(prod._id));
    expect(plan.found.map((f) => f.coll).sort()).toEqual(['materials', 'productmodules', 'products']);
  });

  it('деталь и тот же размер на сайте — «same»; другой вес — расхождение «сайт | PDM»', () => {
    const base = { article: '0000.0000.2002', materialKind: 'part', pdm: { version: 1, state: 'Утверждено' }, dimensions: [{ type: 'length', value: 600 }, { type: 'width', value: 400 }, { type: 'thickness', value: 21 }], weightKg: 3.5, weightUnit: 'kg' };
    const t = tree();
    // состав сайта = состав PDM: ссылка на сортамент, количество 0.24 м²
    const prof = doc({ assortment: 'Фанера, 21 мм', materialGrade: 'ФСФ', isProfile: true, materialKind: 'raw' });
    const withLines = { ...base, composition: [{ lineType: 'material', refId: prof._id, quantity: 0.24 }] };
    const same = buildPlan(t, { ...empty(), materials: [doc(withLines)], profiles: [prof] });
    expect(rowOf(same, '0000.0000.2002').action).toBe('same');
    const diff = buildPlan(t, { ...empty(), materials: [doc({ ...withLines, weightKg: 4 })], profiles: [prof] });
    expect(rowOf(diff, '0000.0000.2002')).toMatchObject({ action: 'conflict', fields: [{ field: 'weightKg', site: 4, pdm: 3.5 }] });
    // старая запись без weightUnit хранит граммы: 3500 г = 3,5 кг — расхождения нет
    const grams = buildPlan(t, { ...empty(), materials: [doc({ ...withLines, weightKg: 3500, weightUnit: undefined })], profiles: [prof] });
    expect(rowOf(grams, '0000.0000.2002').action).toBe('same');
  });

  it('метиз: точное совпадение по pdmCode, по другому написанию; один по ключу — link, несколько — suggest', () => {
    const t = tree();
    const byCode = doc({ article: 'ШАЙБА-8', pdmCode: 'SHP08.D125', pdmAliases: ['ШП08.D125'] });
    const p1 = buildPlan(t, { ...empty(), materials: [byCode] });
    expect(rowOf(p1, 'SHP08.D125')).toMatchObject({ action: 'same', by: 'pdmCode', targetId: String(byCode._id) });
    const byAlias = doc({ article: 'Ш8', pdmAliases: ['SHP08.D125'] });
    expect(rowOf(buildPlan(t, { ...empty(), materials: [byAlias] }), 'SHP08.D125')).toMatchObject({ action: 'link', by: 'alias' });

    const key = pdmKey(t.items.find((i) => i.designation === 'SHP08.D125')!);
    expect(key).not.toBe('');
    const a = doc({ article: 'ШП-1', name: 'Шайба плоская M8 DIN 125' }), b = doc({ article: 'ШП-2', name: 'Шайба плоская M8 DIN 125' });
    expect(siteKey(a)).toBe(key);
    expect(rowOf(buildPlan(t, { ...empty(), byKey: new Map([[key, [a]]]) }), 'SHP08.D125')).toMatchObject({ action: 'link', by: 'matchKey', targetId: String(a._id) });
    const many = rowOf(buildPlan(t, { ...empty(), byKey: new Map([[key, [a, b]]]) }), 'SHP08.D125');
    expect(many.action).toBe('suggest');
    expect(many.candidates?.map((c) => c.article)).toEqual(['ШП-1', 'ШП-2']);
  });

  it('точный поиск: артикул важнее pdmCode, потом другие написания', () => {
    const item = tree().items.find((i) => i.designation === 'SHP08.D125')!;
    const art = doc({ article: 'SHP08.D125' }), code = doc({ pdmCode: 'SHP08.D125' }), alias = doc({ pdmAliases: ['ШП08.D125'] });
    expect(exactHit(item, [code, alias, art])).toMatchObject({ by: 'article', docs: [art] });
    expect(exactHit(item, [alias, code])?.by).toBe('pdmCode');
    expect(exactHit(item, [alias])?.by).toBe('alias');
    expect(exactHit(item, [])).toBeNull();
  });

  it('сортамент на сайте (в том числе удалённый) переиспользуется', () => {
    const prof = doc({ assortment: 'Лист, 4 мм, ГОСТ 19903-2015', materialGrade: 'Ст 3 ГОСТ 380-2005', isProfile: true, materialKind: 'raw', deletedAt: new Date('2026-10-01') });
    const plan = buildPlan(tree(), { ...empty(), profiles: [prof] });
    expect(plan.raws.find((r) => r.action === 'link')).toMatchObject({ targetId: String(prof._id), deleted: true });
    expect(plan.raws).toHaveLength(2);
  });

  it('деталь без заготовки получает пометку, а не строку сырья', () => {
    const t = tree(); delete t.items.find((i) => i.designation === '0000.1005.0002')!.blank;
    expect(rowOf(buildPlan(t, empty()), '0000.1005.0002').notes).toEqual(['Нужен размер заготовки']);
  });

  it('артикул занят не деталью — блокировка', () => {
    const plan = buildPlan(tree(), { ...empty(), materials: [doc({ article: '0000.1005.0001', materialKind: 'fastener' })] });
    expect(plan.blockers.join(' ')).toContain('не как деталь');
  });
});
