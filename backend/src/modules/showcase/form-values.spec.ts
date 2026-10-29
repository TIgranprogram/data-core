import { tallyValues, withDict } from './form-values';

describe('подсказки формы изделия (ФИ)', () => {
  it('считает без регистра и «ё», берёт самое частое написание, частое — выше', () => {
    expect(tallyValues(['Зелёный', 'зеленый', 'Зелёный', ' Графит ', '', null, 'Графит', 'синий'])).toEqual([
      { value: 'Зелёный', n: 3 }, { value: 'Графит', n: 2 }, { value: 'синий', n: 1 }]);
  });
  it('справочник: недостающее — в конец с n=0, у совпавшего — подпись', () => {
    expect(withDict([{ value: 'Графит', n: 2 }], [{ value: 'графит', sub: 'RAL 7024' }, { value: 'RAL 6005 зелёный мох' }])).toEqual([
      { value: 'Графит', n: 2, sub: 'RAL 7024' }, { value: 'RAL 6005 зелёный мох', n: 0 }]);
  });
});

import { passportCategoryFor } from './form-values';
describe('изделие → категория паспорта (ФИ2)', () => {
  const cats = [{ code: 'TRN', name: 'Уличный тренажёр', catalogNames: 'Уличный тренажёр, Тренажёр уличный' }, { code: 'DIO', name: 'Детское', catalogNames: 'Качели' }];
  it('сначала группа, потом раздел; без регистра и «ё»', () => {
    expect(passportCategoryFor({ type: 'уличный тренажер', group: 'Качели' }, cats)).toEqual({ code: 'DIO', name: 'Детское', via: 'группа «Качели»', source: 'dict' });
    expect(passportCategoryFor({ type: 'уличный тренажер', group: 'Прочее' }, cats)?.code).toBe('TRN');
  });
  it('не нашли — null', () => expect(passportCategoryFor({ type: 'МАФ', group: null }, cats)).toBeNull());
});

import { resolvePassportCategory } from './form-values';
describe('наследование категории паспорта (PASSPORT-CATEGORY)', () => {
  const cats = [{ code: 'BLG', name: 'Благоустройство', catalogNames: '' }, { code: 'WRK', name: 'Воркаут', catalogNames: 'Скамьи' }, { code: 'TRN', name: 'Тренажёр', catalogNames: '' }];
  it('группа главнее раздела и справочника', () => {
    expect(passportCategoryFor({ group: 'Скамьи', type: 'Благоустройство' }, cats, { group: 'BLG', type: 'TRN' })).toEqual({ code: 'BLG', name: 'Благоустройство', via: 'группа «Скамьи»', source: 'group' });
  });
  it('нет у группы — берётся раздел', () => {
    expect(passportCategoryFor({ group: 'Скамьи', type: 'Благоустройство' }, cats, { group: '', type: 'TRN' })).toMatchObject({ code: 'TRN', source: 'type', via: 'раздел «Благоустройство»' });
  });
  it('нигде не задано — запасной catalogNames, затем null', () => {
    expect(passportCategoryFor({ group: 'Скамьи' }, cats)).toMatchObject({ code: 'WRK', source: 'dict' });
    expect(passportCategoryFor({ group: 'Лавки' }, cats)).toBeNull();
  });
  it('ручная категория изделия главнее группы, унаследованная остаётся отдельно', () => {
    const inh = passportCategoryFor({ group: 'Скамьи' }, cats, { group: 'BLG' });
    const r = resolvePassportCategory('WRK', inh, cats);
    expect(r.effective).toMatchObject({ code: 'WRK', source: 'own' });
    expect(r.own).toEqual({ code: 'WRK', name: 'Воркаут' });
    expect(r.inherited?.code).toBe('BLG');
    expect(resolvePassportCategory(undefined, inh, cats).effective?.code).toBe('BLG');
    expect(resolvePassportCategory('', null, cats).effective).toBeNull();
  });
});
