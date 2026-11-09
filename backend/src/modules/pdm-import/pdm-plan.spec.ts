import { BadRequestException } from '@nestjs/common';
import { matchKey } from '../../common/catalog/match-key';
import type { PdmTreeDto } from './dto/pdm-tree.dto';
import { checkLines, checkTree, diffPart, foldLines, linesOf, rawUnit, rawUsage, sortamentOf, writeOrder } from './pdm-plan';
import { miniTree } from './pdm-tree.testkit';

const clone = (): PdmTreeDto => JSON.parse(JSON.stringify(miniTree()));
const itemOf = (t: PdmTreeDto, d: string) => t.items.find((i) => i.designation === d)!;

describe('расход сырья детали', () => {
  it('лист: длина × ширина заготовки в м²', () => {
    expect(rawUsage('Лист, 4 мм, ГОСТ 19903-2015', { length: 253.1, width: 80 })).toEqual({ quantity: 0.020248, unit: 'м²' });
  });
  it('фанера — тоже м²', () => {
    expect(rawUsage('Фанера, 21 мм', { length: 600, width: 400 })).toEqual({ quantity: 0.24, unit: 'м²' });
  });
  it('труба и брус: длина заготовки в метрах', () => {
    expect(rawUsage('Труба 40×40×2', { length: 1500, width: 40 })).toEqual({ quantity: 1.5, unit: 'м' });
    expect(rawUsage('Брус 100×100', { length: 6000 })).toEqual({ quantity: 6, unit: 'м' });
  });
  it('нет заготовки или нужного размера — нет и расхода', () => {
    expect(rawUsage('Лист, 4 мм', null)).toBeNull();
    expect(rawUsage('Лист, 4 мм', { length: 253, width: null })).toBeNull();
    expect(rawUsage('Труба', { width: 50 })).toBeNull();
    expect(rawUsage('', { length: 100, width: 100 })).toBeNull();
  });
  it('единица сортамента: лист и фанера — м², остальное — м', () => {
    expect(['Лист', 'Лист нерж.', 'Фанера ФСФ', 'Труба ВГП', 'Брус', 'Уголок 50×50'].map(rawUnit)).toEqual(['м²', 'м²', 'м²', 'м', 'м', 'м']);
  });
});

describe('сортамент детали', () => {
  it('ключ сортамента на сайте (из созданной записи) равен ключу строки PDM', () => {
    const s = sortamentOf(itemOf(clone(), '0000.1005.0001'))!;
    expect(s.unit).toBe('м²');
    expect(s.name).toBe('Лист, 4 мм, ГОСТ 19903-2015, Ст 3 ГОСТ 380-2005');
    expect(matchKey({ kind: 'raw', assortment: s.assortment, materialGrade: s.material, name: s.name })).toBe(s.key);
  });
  it('без сортамента — нет', () => {
    const t = clone(); delete itemOf(t, '0000.1005.0001').vars;
    expect(sortamentOf(itemOf(t, '0000.1005.0001'))).toBeNull();
  });
});

describe('проверка дерева', () => {
  it('нормальное дерево — без блокировок', () => {
    expect(checkTree(clone())).toEqual([]);
  });
  it.each(['../x', 'a..b', '.hidden'])('обозначение «%s» — 400', (bad) => {
    const t = clone(); t.items[2].designation = bad;
    expect(() => checkTree(t)).toThrow(BadRequestException);
  });
  it('повтор позиции, неизвестная связь, корень не изделие — 400', () => {
    const dup = clone(); dup.items.push({ ...dup.items[2] });
    expect(() => checkTree(dup)).toThrow(/дважды/);
    const unknown = clone(); unknown.bom.push({ parent: unknown.root, child: 'НЕТ', qty: 1 });
    expect(() => checkTree(unknown)).toThrow(/неизвестная/);
    const noProduct = clone(); noProduct.items[0].kind = 'module';
    expect(() => checkTree(noProduct)).toThrow(/изделием/);
  });
  it('цикл в составе — 400', () => {
    const t = clone(); t.bom.push({ parent: '0000.1005.0000', child: '0000.1005.0000', qty: 1 });
    expect(() => checkTree(t)).toThrow(/цикл/);
  });
  it('у детали не бывает состава, у метиза — файлов: блокировки для предпросмотра', () => {
    const t = clone();
    t.bom.push({ parent: '0000.1005.0001', child: 'SHP08.D125', qty: 1 });
    itemOf(t, 'SHP08.D125').docs = [{ type: 'pdf', name: 'a.pdf', version: 1, sha256: 'a'.repeat(64) }];
    const blockers = checkTree(t);
    expect(blockers).toHaveLength(2);
    expect(blockers.join(' ')).toContain('0000.1005.0001');
  });
  it('конфигурации с разными размерами блокируют загрузку', () => {
    const t = clone(); t.warnings = [{ designation: '0000.1005.0001', code: 'config-conflict', text: 'два размера' }];
    expect(checkTree(t)).toHaveLength(1);
  });
});

describe('порядок записи', () => {
  it('дети раньше родителей, изделие последним', () => {
    const order = writeOrder(miniTree());
    expect(order.indexOf('0000.1005.0001')).toBeLessThan(order.indexOf('0000.1005.0000'));
    expect(order.indexOf('0000.1005.0000')).toBeLessThan(order.indexOf('6104.0000.0000'));
    expect(order[order.length - 1]).toBe('6104.0000.0000');
    expect(new Set(order).size).toBe(miniTree().items.length);
  });
});

describe('строки состава', () => {
  const refOf = (d: string) => `id:${d}`, rawRef = (k: string) => `raw:${k}`;
  it('деталь — одна строка сырья с заготовкой', () => {
    const t = miniTree(), lines = linesOf(t, itemOf(t, '0000.1005.0001'), refOf, rawRef);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ lineType: 'material', quantity: 0.020248, unit: 'м²', overrideDimensions: { length: 253.1, width: 80, height: 4, unit: 'мм' } });
  });
  it('деталь без заготовки — без строки сырья', () => {
    const t = clone(); delete itemOf(t, '0000.1005.0001').blank;
    expect(linesOf(t, itemOf(t, '0000.1005.0001'), refOf, rawRef)).toEqual([]);
  });
  it('изделие: модуль, деталь, метиз, покупное', () => {
    const t = miniTree(), lines = linesOf(t, itemOf(t, t.root), refOf, rawRef);
    expect(lines.map((l) => [l.lineType, l.ref, l.quantity])).toEqual([['module', 'id:0000.1005.0000', 1], ['material', 'id:0000.0000.2002', 2], ['material', 'id:SHP08.D125', 8], ['material', 'id:PI.0003', 1]]);
  });
  it('разные обозначения, приведённые к одной записи, складываются в одну строку', () => {
    const t = miniTree(), same = () => 'id:общая';
    const lines = linesOf(t, itemOf(t, t.root), same, rawRef).filter((l) => l.lineType === 'material');
    expect(lines).toEqual([expect.objectContaining({ ref: 'id:общая', quantity: 11 })]);
    expect(foldLines([{ lineType: 'material', ref: 'a', quantity: 1 }, { lineType: 'module', ref: 'a', quantity: 1 }, { lineType: 'material', ref: 'a', quantity: 2 }]).map((l) => l.quantity)).toEqual([3, 1]);
  });
});

describe('правила состава', () => {
  const line = (lineType: 'material' | 'module' | 'product') => [{ lineType, ref: 'x', quantity: 1, sortOrder: 0 }];
  it('в детали — только сырьё', () => {
    expect(checkLines('part', 'D', line('material'), () => 'raw')).toBeNull();
    expect(checkLines('part', 'D', line('material'), () => 'fastener')).toMatch(/только сырьё/);
    expect(checkLines('part', 'D', line('module'), () => 'module')).toMatch(/только сырьё/);
  });
  it('в изделии — без сырья', () => {
    expect(checkLines('product', 'P', line('material'), () => 'raw')).toMatch(/нельзя добавить сырьё/);
    expect(checkLines('product', 'P', line('material'), () => 'part')).toBeNull();
    expect(checkLines('product', 'P', line('module'), () => 'module')).toBeNull();
  });
  it('изделие нельзя положить в модуль', () => {
    expect(checkLines('module', 'M', line('product'), () => 'product')).toMatch(/нельзя включить/);
    expect(checkLines('module', 'M', line('material'), () => 'raw')).toBeNull();
  });
});

describe('сравнение «сайт | PDM»', () => {
  const pdm = { dimensions: [{ type: 'length', value: 109 }, { type: 'width', value: 80 }, { type: 'thickness', value: 79 }], weightKg: 0.27, colors: ['8017'], lines: [] };
  it('пустое на сайте заполняется, равное молчит', () => {
    expect(diffPart({}, pdm)).toEqual({ fill: ['dimensions', 'weightKg', 'colors'], conflicts: [] });
    expect(diffPart({ dimensions: pdm.dimensions, weightKg: 0.2700001, colors: ['8017'] }, pdm)).toEqual({ fill: [], conflicts: [] });
  });
  it('отличающееся — расхождение с обеими сторонами; состав сайта без заготовки PDM не считается расхождением', () => {
    const d = diffPart({ dimensions: [{ type: 'length', value: 100 }], weightKg: 1, colors: ['9005'], composition: [{ lineType: 'material', refId: 'a', quantity: 1 }] }, pdm);
    expect(d.conflicts.map((c) => c.field)).toEqual(['dimensions', 'weightKg', 'colors']);
    expect(d.conflicts[1]).toEqual({ field: 'weightKg', site: 1, pdm: 0.27 });
  });
});
