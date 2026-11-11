import { suggestElementNames, suggestPurposeName } from './name-suggest';

describe('C078: элементы по названию', () => {
  it('одиночное изделие — первое совпавшее имя', () => {
    expect(suggestElementNames('Стойка баскетбольная уличная', 'WRK')).toMatchObject({ names: ['Баскетбольная стойка'], how: 'по названию' });
    expect(suggestElementNames('Скамья парковая', 'BLG')!.names).toEqual(['Скамья']);
    expect(suggestElementNames('Скамья для пресса', 'WRK')!.names).toEqual(['Скамья для пресса']);
  });
  it('навес, помост и трибуны не подсказываются', () => {
    expect(suggestElementNames('Навес над входом', 'BLG')).toBeNull();
    expect(suggestElementNames('Трибуна на 50 мест', 'WRK')).toBeNull();
  });
  it('тренажёр — только категория ТРН и не пресс', () => {
    expect(suggestElementNames('Жим ногами', 'TRN')!.names).toEqual(['Тренажёр для мышц ног и ягодиц']);
    expect(suggestElementNames('Велотренажёр', 'TRN')!.names).toEqual(['Кардиотренажёр']);
    expect(suggestElementNames('Жим от груди', 'WRK')).toBeNull();
    expect(suggestElementNames('Гиперэкстензия', 'TRN')).toBeNull();
  });
  it('воркаут — состав по словам; кольца и канат остаются вручную; пресс вытесняет скамью', () => {
    expect(suggestElementNames('Турник, брусья, рукоход', 'WRK', 'Воркаут')!.names).toEqual(['Турник', 'Брусья', 'Рукоход']);
    expect(suggestElementNames('Турник скамья и пресс', 'WRK', 'Воркаут')!.names).toEqual(['Турник', 'Скамья для пресса']);
    expect(suggestElementNames('Комплекс воркаут с кольцами', 'WRK', 'Воркаут')).toBeNull();
  });
});

describe('C078: назначение по названию', () => {
  it('воркаут и благоустройство', () => {
    expect(suggestPurposeName('Стойка баскетбольная', 'WRK')).toMatchObject({ name: 'Баскетбол' });
    expect(suggestPurposeName('Урна парковая', 'WRK')).toMatchObject({ name: 'Сбор мусора' });
    expect(suggestPurposeName('Комплекс воркаут', 'WRK')).toMatchObject({ name: 'Комплекс с собственным весом' });
    expect(suggestPurposeName('Жим+подтягивание', 'TRN')).toMatchObject({ name: 'Комплексный' });
    expect(suggestPurposeName('Велотренажёр', 'TRN')).toMatchObject({ name: 'Кардио' });
    expect(suggestPurposeName('Качели гнездо', 'DIO')).toMatchObject({ name: 'Игровое' });
  });
  it('благоустройство без слова — прочее, если группа так называется; чужая категория — пусто', () => {
    expect(suggestPurposeName('Лавка', 'BLG', 'Благоустройство')).toMatchObject({ name: 'Прочее благоустройство', word: '' });
    expect(suggestPurposeName('Лавка', 'BLG', 'Спорт')).toBeNull();
    expect(suggestPurposeName('Турник', 'DSP')).toBeNull();
  });
});
