import { missingKeyed } from './passport-rules';

/** ФП: «не хватает для выпуска» — подпись и поле формы, куда перейти. */
describe('missingKeyed — не хватает с ключом поля формы', () => {
  const cat = { requiredFields: 'heightMin\nmaxUsers — Сколько человек', requiredImages: 'overview\nsafety_zone\nassembly (если разборное)' };
  it('поля категории, рисунки (safety_zone → img_safety), v1-поля', () => {
    const m = missingKeyed({ passportCategory: 'TRN', name: 'Турник', images: [{ kind: 'overview' }] } as never, cat);
    const by = Object.fromEntries(m.map((x) => [x.label, x.key]));
    expect(by['Рост пользователя от']).toBe('heightMin');
    expect(by['Сколько человек']).toBe('maxUsers');
    expect(by['Рисунок: Зона безопасности']).toBe('img_safety');
    expect(by['Дата']).toBe('date');
    expect(by['Способ установки']).toBe('installationTypeId');
    expect(Object.keys(by)).not.toContain('Рисунок: Сборка по шагам'); // не разборное
  });
  it('загруженная «зона безопасности» вида safety засчитывается', () => {
    const m = missingKeyed({ passportCategory: 'TRN', images: [{ kind: 'overview' }, { kind: 'safety' }] } as never, cat);
    expect(m.map((x) => x.label)).not.toContain('Рисунок: Зона безопасности');
  });
});
