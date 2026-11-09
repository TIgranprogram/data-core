import { designationKey, matchKey, matchKeyPdm, type MatchInput, type PdmMatchInput } from './match-key';

const site = (name: string, extra: Partial<MatchInput> = {}): string => matchKey({ name, ...extra });
const pdm = (assortment: string | null, material: string | null = null, kind = 'raw', size?: PdmMatchInput['size']): string => matchKeyPdm({ kind, assortment, material, size });

describe('matchKey: пары «PDM ↔ прод» дают один ключ', () => {
  const pairs: Array<[string, string, string]> = [
    // [описание, ключ PDM, ключ позиции]
    ['болт мебельный M8х110', pdm('Болт мебельный, M8х110, DIN 603', null, 'fastener'), site('Болт мебельный, M8х110, DIN 603', { kind: 'fastener' })],
    ['кириллическая М', pdm('Болт мебельный, M8х110, DIN 603', null, 'fastener'), site('Болт мебельный, М8×110, DIN 603')],
    ['латинская x и пробелы', pdm('Болт мебельный, M10х120, DIN 603', null, 'fastener'), site('Болт мебельный M10 x 120 DIN 603')],
    ['болт: структурные поля вместо названия', pdm('Болт мебельный, M8х110, DIN 603', null, 'fastener'), site('СКЛ-2026-041', { kind: 'fastener', typeName: 'Болт мебельный', standardRef: 'DIN 603', dimensions: [{ type: 'diameter', value: 8 }, { type: 'length', value: 110 }] })],
    ['болт: длина из габарита PDM', pdm('Болт мебельный, M8, DIN 603', null, 'fastener', { length: 110 }), site('Болт мебельный, M8х110, DIN 603')],
    ['шайба: M8 в одной и «8» в другой', pdm('Шайба плоская, 8, DIN 125', null, 'fastener'), site('Шайба плоская M8 DIN 125')],
    ['шайба: DIN 125 A', pdm('Шайба, M8, DIN 125-A', null, 'fastener'), site('Шайба M8 DIN 125 A', { kind: 'other' })],
    ['гайка', pdm('Гайка шестигранная, M10, DIN 934', null, 'fastener'), site('Гайка шестигранная М10 DIN 934')],
    ['лист Ст3: ГОСТ с годом и без', pdm('Лист, 4 мм, ГОСТ 19903-2015', 'Ст 3 ГОСТ 380-2005'), site('Лист Ст3, 4 мм, ГОСТ 19903-74')],
    ['лист Ст3: «Сталь 3»', pdm('Лист, 4 мм, ГОСТ 19903-2015', 'Ст 3 ГОСТ 380-2005'), site('Лист Сталь 3, 4 мм, ГОСТ 19903')],
    ['лист Ст3: «Ст3сп»', pdm('Лист, 4 мм, ГОСТ 19903-2015', 'Ст3сп'), site('Лист Ст.3, 4 мм ГОСТ 19903')],
    ['лист нерж: AISI 304, формат отброшен', pdm('Лист, 1,5 мм', 'AISI 304'), site('Лист AISI 304, 1,5 мм, 1250×2500')],
    ['лист нерж: другой формат — тот же сортамент', site('Лист AISI 304, 1,5 мм, 1500×3000'), site('Лист AISI 304, 1,5 мм, 1250×2500')],
    ['«нерж.» = AISI 304', pdm('Лист нерж., 1,5 мм'), site('Лист AISI 304, 1,5 мм, 1250×2500')],
    ['лист: структурные поля', pdm('Лист, 1,5 мм', 'AISI 304'), site('Лист 1', { kind: 'raw', assortment: 'Лист 1,5 мм', materialGrade: 'AISI 304', dimensions: [{ type: 'length', value: 2500 }, { type: 'width', value: 1250 }, { type: 'thickness', value: 1.5 }] })],
    ['лист: толщина из размеров', pdm('Лист, 0,5 мм', 'AISI 304'), site('Лист AISI 304', { dimensions: [{ type: 'thickness', value: 0.5 }] })],
    ['фанера: берёза ФСФ', pdm('Фанера, 21 мм', 'Берёза ФСФ'), site('Фанера берёзовая ФСФ, 21 мм, 1525×1525')],
    ['фанера: «березовая» и «берёза»', pdm('Фанера, 15 мм', 'берёзовая ФСФ'), site('Фанера, береза ФСФ, 15 мм')],
    ['труба ВГП', pdm('Труба ВГП 25×2,8, ГОСТ 3262-75'), site('Труба ВГП 25х2,8 ГОСТ 3262')],
    ['труба: размеры из полей', pdm('Труба ВГП 25×2,8'), site('Труба ВГП', { dimensions: [{ type: 'diameter', value: 25 }, { type: 'thickness', value: 2.8 }] })],
    ['брус 100×100', pdm('Брус, 100×100', 'Сосна'), site('Брус 100х100, сосна')],
    ['брус: сосновый', pdm('Брус, 100×100', 'Сосна'), site('Брус сосновый 100×100')],
    ['оцинкованный', pdm('Болт мебельный, M8х110, DIN 603', 'оцинк. сталь', 'fastener'), site('Болт мебельный, M8х110, DIN 603, оцинкованный')],
    ['запятая и точка в десятичных', pdm('Лист, 1,5 мм', 'AISI 304'), site('Лист AISI 304, 1.5 мм')],
  ];
  it.each(pairs)('%s', (_name, a, b) => {
    expect(a).not.toBe('');
    expect(a).toBe(b);
  });

  it('вид ключа понятен глазу', () => {
    expect(pdm('Болт мебельный, M8х110, DIN 603', null, 'fastener')).toBe('fastener·болт мебельный·din603·м8×110·');
    expect(pdm('Лист, 4 мм, ГОСТ 19903-2015', 'Ст 3 ГОСТ 380-2005')).toBe('raw·лист·гост19903·t4·ст3');
    expect(pdm('Лист, 1,5 мм', 'AISI 304')).toBe('raw·лист··t1.5·aisi304');
  });
});

describe('matchKey: разные позиции — разные ключи', () => {
  const diff: Array<[string, string, string]> = [
    ['длина болта 110 ≠ 100', site('Болт мебельный, M8х110, DIN 603'), site('Болт мебельный, M8х100, DIN 603')],
    ['резьба M8 ≠ M10', site('Болт мебельный, M8х110, DIN 603'), site('Болт мебельный, M10х110, DIN 603')],
    ['стандарт DIN 603 ≠ DIN 912', site('Болт, M8х30, DIN 603'), site('Болт, M8х30, DIN 912')],
    ['болт ≠ винт', site('Болт, M8х30, DIN 933'), site('Винт, M8х30, DIN 933')],
    ['лист 1,5 ≠ 2', site('Лист AISI 304, 1,5 мм'), site('Лист AISI 304, 2 мм')],
    ['AISI 304 ≠ Ст3', site('Лист, 2 мм, AISI 304'), site('Лист, 2 мм, Ст3')],
    ['AISI 304 ≠ AISI 316', site('Лист AISI 304, 2 мм'), site('Лист AISI 316, 2 мм')],
    ['лист ≠ фанера', site('Лист, 4 мм'), site('Фанера, 4 мм')],
    ['труба 25×2,8 ≠ 25×3', site('Труба ВГП 25×2,8'), site('Труба ВГП 25×3')],
    ['брус 100×100 ≠ 100×50', site('Брус 100×100'), site('Брус 100×50')],
    ['оцинк ≠ без покрытия', site('Болт, M8х30, DIN 933, оцинк.'), site('Болт, M8х30, DIN 933')],
    ['ГОСТ 19903 ≠ ГОСТ 19904', site('Лист, 2 мм, ГОСТ 19903'), site('Лист, 2 мм, ГОСТ 19904')],
  ];
  it.each(diff)('%s', (_name, a, b) => {
    expect(a).not.toBe('');
    expect(a).not.toBe(b);
  });

  it('вид сырья и покупного не смешивается', () => {
    expect(matchKey({ name: 'Лист, 4 мм', kind: 'raw' })).not.toBe(matchKey({ name: 'Лист, 4 мм', kind: 'purchased' }));
  });
});

describe('matchKey: пустое', () => {
  it('нет типа — ключа нет', () => {
    expect(matchKey({})).toBe('');
    expect(matchKey({ name: '   ' })).toBe('');
    expect(matchKeyPdm({ kind: 'fastener' })).toBe('');
  });
  it('тип только из typeName', () => {
    expect(matchKey({ typeName: 'Соединитель' })).toBe('·соединитель···');
  });
});

describe('designationKey', () => {
  it.each([
    ['SHP08.D125', 'ШП08.D125'],
    ['SK08.080.PRSH', 'СК08.080.ПРШ'],
    ['BM08.110.D603', 'БМ08.110.D603'],
    ['0000.0000.0019', '0000.0000.0019'],
    ['PI.0003', 'ПИ.0003'],
  ])('%s = %s', (a, b) => expect(designationKey(a)).toBe(designationKey(b)));
  it('разные коды — разные ключи', () => {
    expect(designationKey('SHP08.D125')).not.toBe(designationKey('SHP10.D125'));
    expect(designationKey(null)).toBe('');
  });
});
