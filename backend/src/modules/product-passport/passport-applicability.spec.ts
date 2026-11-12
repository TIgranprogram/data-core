import { applicability, facetApplies, productType, USER_FIELDS } from './passport-applicability';
import { V2_REQUIRED_FIELDS } from './passport-rules';

/** C086: применимость вопросов по категории и типу — состав полей, а не число «готово». */
describe('C086: тип изделия благоустройства', () => {
  it('категории, кроме BLG, типа не требуют', () => {
    for (const code of ['DIO', 'DSP', 'TRN', 'WRK']) expect(productType(code, {})).toMatchObject({ needed: false, known: true, code: null });
  });
  it('назначение → тип; указатель (Информирование) — не ограждение и не сиденье', () => {
    expect(productType('BLG', { purposeName: 'Информирование' })).toMatchObject({ code: 'other', source: 'purpose', known: true });
    expect(productType('BLG', { purposeName: 'Ограждение' })).toMatchObject({ code: 'fence', source: 'purpose' });
    expect(productType('BLG', { purposeName: 'Отдых' })).toMatchObject({ code: 'seating' });
    expect(productType('BLG', { purposeName: 'Зрительские места' })).toMatchObject({ code: 'seating' });
  });
  it('назначения нет: тип по указанному признаку или по группе каталога', () => {
    expect(productType('BLG', { facetCodes: ['blg.material', 'blg.fence'] })).toMatchObject({ code: 'fence', source: 'facet' });
    expect(productType('BLG', { group: 'Ограждения' })).toMatchObject({ code: 'fence', source: 'group' });
    expect(productType('BLG', { group: 'Скамьи' })).toMatchObject({ code: 'seating', source: 'group' });
    expect(productType('BLG', { group: 'Информационные стенды и указатели' })).toMatchObject({ code: 'other', source: 'group' });
  });
  it('широкая группа «Благоустройство (…)» тип не называет — нужно уточнение', () => {
    expect(productType('BLG', { group: 'Благоустройство (оборудование невошедшее в другие группы)' })).toMatchObject({ code: null, known: false, needed: true });
    expect(productType('BLG', {})).toMatchObject({ known: false, needed: true });
  });
  it('выбранное назначение сильнее группы', () => {
    expect(productType('BLG', { purposeName: 'Информирование', group: 'Ограждения' }).code).toBe('other');
  });
  it.each([
    ['Информационные стенды и указатели', 'blg.rail', 'other'],
    ['Ограждения', 'blg.seat', 'fence'],
    ['Скамьи', 'blg.fence', 'seating'],
  ])('группа %s сильнее старого признака %s', (group, facet, expected) => {
    const type = productType('BLG', { group, facetCodes: [facet] });
    expect(type).toMatchObject({ code: expected, source: 'group', known: true });
    expect(facetApplies(facet, type)).toBe(false);
  });
  it('широкая группа сохраняет определение по признакам', () => {
    expect(productType('BLG', { group: 'Благоустройство', facetCodes: ['blg.seat'] }))
      .toMatchObject({ code: 'seating', source: 'facet' });
  });
});

describe('C086: признаки по типу', () => {
  const type = (purposeName?: string) => productType('BLG', { purposeName });
  const typed = ['blg.fence', 'blg.seats', 'blg.seat', 'blg.rail'];
  it('указатель: ни элементов ограждения, ни мест/сиденья/перил; материал остаётся', () => {
    expect(typed.filter((c) => facetApplies(c, type('Информирование')))).toEqual([]);
    expect(facetApplies('blg.material', type('Информирование'))).toBe(true);
  });
  it('ограждение: элемент ограждения есть, сиденья нет', () => {
    expect(typed.filter((c) => facetApplies(c, type('Ограждение')))).toEqual(['blg.fence']);
  });
  it('скамья, трибуна: места, сиденье, перила; элемента ограждения нет', () => {
    expect(typed.filter((c) => facetApplies(c, type('Отдых')))).toEqual(['blg.seats', 'blg.seat', 'blg.rail']);
  });
  it('тип неизвестен: зависящие от типа признаки не спрашиваются', () => {
    expect(typed.filter((c) => facetApplies(c, type()))).toEqual([]);
  });
  it('признаки других категорий и новые коды справочника не скрываются', () => {
    const trn = productType('TRN', {});
    expect(['trn.kind', 'trn.muscles', 'dio.age', 'blg.new'].every((c) => facetApplies(c, trn))).toBe(true);
    expect(facetApplies('blg.new', type())).toBe(true);
  });
});

describe('C086: поля по категории', () => {
  const of = (code: string, cat?: { requiredFields?: string; requiredImages?: string }) => applicability(code, cat ?? null, productType(code, { purposeName: 'Информирование' }));
  it('благоустройство: параметров пользователя, падения и площадки нет; срок службы обязателен, гарантия применима', () => {
    const a = of('BLG');
    expect(USER_FIELDS.filter((k) => k in a.fields)).toEqual([]);
    expect(a.fields).toEqual({ serviceLifeYears: 'required', warrantyMonths: 'optional' });
    expect(a.elements).toBe('optional');
  });
  it('все категории из кода покрыты: обязательные поля категории остались обязательными', () => {
    for (const [code, list] of Object.entries(V2_REQUIRED_FIELDS)) {
      const a = of(code);
      expect(list.map(([k]) => k).filter((k) => a.fields[k] !== 'required')).toEqual([]);
      expect(a.fields.warrantyMonths).toBe('optional');
    }
  });
  it('тренажёр: рост, вес, пользователи, площадка обязательны; высота падения не применима', () => {
    const a = of('TRN');
    expect(['heightMin', 'weightMax', 'maxUsers', 'siteLength', 'siteWidth', 'serviceLifeYears'].every((k) => a.fields[k] === 'required')).toBe(true);
    expect(a.fields.heightMax).toBe('optional');
    expect('fallHeight' in a.fields).toBe(false);
    expect(a.elements).toBe('required');
  });
  it('детское игровое: возраст, падение, площадка обязательны; сборка зависит от «как поставляется»', () => {
    const a = of('DIO', { requiredImages: 'overview\ndimensions\nassembly (если разборное)' });
    expect(['ageFrom', 'ageTo', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth'].every((k) => a.fields[k] === 'required')).toBe(true);
    expect(a.kit).toBe('required');
    expect(of('BLG', { requiredImages: 'overview\ndimensions' }).kit).toBe('optional');
  });
  it('справочник категории сильнее кода: поле из справочника обязательно и применимо', () => {
    expect(of('BLG', { requiredFields: 'serviceLifeYears\nmaxUsers — Мест' }).fields).toMatchObject({ maxUsers: 'required', serviceLifeYears: 'required' });
  });
  it('неизвестная категория: только общие числа', () => {
    expect(of('XXX').fields).toEqual({ serviceLifeYears: 'optional', warrantyMonths: 'optional' });
  });
});
