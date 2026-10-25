import { APP_SECTION_IDS, appSectionLabel, appSectionsFor } from './app-sections';

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
