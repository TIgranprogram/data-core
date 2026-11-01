import { APP_SECTION_IDS, appSectionLabel, appSectionsFor, sectionOpen } from './app-sections';

describe('app-sections: Документация', () => {
  it('docs и старый passports — оба в списке, id уникальны', () => {
    expect(APP_SECTION_IDS).toEqual(expect.arrayContaining(['docs', 'passports']));
    expect(new Set(APP_SECTION_IDS).size).toBe(APP_SECTION_IDS.length);
  });

  it('подписи', () => {
    expect(appSectionLabel('docs')).toBe('Документация');
    expect(appSectionLabel('passports')).toBe('Документация (паспорта, шаблоны)');
  });

  it('роль с галочкой docs получает её в /auth, admin — null', () => {
    expect(appSectionsFor('manager', ['docs', 'нет-такого'])).toEqual(['docs']);
    expect(appSectionsFor('admin', ['docs'])).toBeNull();
  });
});

describe('app-sections: Склад (телефон)', () => {
  it('раздел есть, открывает только склад и заявки', () => {
    expect(APP_SECTION_IDS).toContain('stock-mobile');
    const open = new Set(['stock-mobile']);
    expect(sectionOpen(open, 'stock')).toBe(true);
    expect(sectionOpen(open, 'requests')).toBe(true);
    expect(sectionOpen(open, 'money')).toBe(false);
  });
});
