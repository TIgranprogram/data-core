import { missingFields, missingFieldsV2 } from './passport-rules';

/** Обязательные по категории паспорта v2 (БЗ-6 Э4a2). */
describe('missingFieldsV2', () => {
  const base = {
    name: 'Тренажёр «Жим»', category: 'Уличный тренажёр', date: '2026-10-22', supplierOrgId: 'x', height: 1, length: 1, width: 1, weight: 1,
    materials: 'сталь', installationMethod: 'бетон', purpose: 'занятия', description: 'описание', customerName: 'Заказчик',
    images: [{ kind: 'overview' }],
  };
  const trnCat = { requiredImages: 'overview\ndimensions\nsafety_zone\nfoundation' };

  it('без категории — как v1', () => {
    expect(missingFieldsV2(base)).toEqual(missingFields(base));
  });

  it('TRN: поля категории, элементы, способ установки и рисунки из справочника', () => {
    const m = missingFieldsV2({ ...base, passportCategory: 'TRN' }, trnCat);
    expect(m).toEqual(expect.arrayContaining(['Элементы', 'Способ установки', 'Рост пользователя от', 'Срок службы', 'Рисунок: Чертёж с размерами', 'Рисунок: Зона безопасности', 'Рисунок: Схема фундамента']));
    expect(m).not.toContain('Рисунок: Фото изделия');
  });

  it('заполнено всё — пусто; v1-вид «safety» засчитывается как зона безопасности; 0 — заполнено', () => {
    const full = {
      ...base, passportCategory: 'TRN', elements: ['e1'], installationTypeId: 'i1', heightMin: 1400, weightMax: 120, maxUsers: 0, siteLength: 3000, siteWidth: 2000, serviceLifeYears: 10,
      images: [{ kind: 'overview' }, { kind: 'dimensions' }, { kind: 'safety' }, { kind: 'foundation' }],
    };
    expect(missingFieldsV2(full, trnCat)).toEqual([]);
  });

  it('v2: текстовые поля v1 (материалы, установка, назначение, описание, категория каталога) заменяет справочник', () => {
    const v2 = { name: 'Т', date: '2026-10-22', supplierOrgId: 'x', height: 1, length: 1, width: 1, weight: 1, customerName: 'З', images: [{ kind: 'overview' }],
      passportCategory: 'MAF', elements: ['e1'], materialIds: ['m1'], installationTypeId: 'i1', serviceLifeYears: 5 };
    expect(missingFieldsV2(v2, { requiredImages: 'overview' })).toEqual([]);
    expect(missingFieldsV2({ ...v2, materialIds: [] }, null)).toEqual(['Материалы']);
  });

  it('обязательные поля — из справочника категорий (ключ или «ключ — подпись»); пусто — по умолчанию из программы (Э9)', () => {
    const v2 = { ...base, passportCategory: 'TRN', elements: ['e1'], installationTypeId: 'i1' };
    const fromDict = missingFieldsV2(v2, { requiredFields: ['maxUsers', 'fallHeight — Высота падения'].join(String.fromCharCode(10)) });
    expect(fromDict).toEqual(expect.arrayContaining(['Пользователей одновременно', 'Высота падения']));
    expect(fromDict).not.toContain('Рост пользователя от');
    expect(missingFieldsV2(v2, { requiredFields: '' })).toContain('Рост пользователя от');
  });

  it('схема сборки «если разборное» — только при isKit; MAF не требует элементов', () => {
    const cat = { requiredImages: 'overview\nassembly (если разборное)' };
    const maf = { ...base, passportCategory: 'MAF', installationTypeId: 'i1', serviceLifeYears: 5 };
    expect(missingFieldsV2(maf, cat)).toEqual([]);
    expect(missingFieldsV2({ ...maf, isKit: true }, cat)).toEqual(['Рисунок: Сборка по шагам']);
  });
});
