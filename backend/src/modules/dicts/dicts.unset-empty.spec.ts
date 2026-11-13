import { DICTS } from './dicts.defs';
import { emptyKeys } from './dicts.service';

const persons = DICTS.find((d) => d.key === 'persons')!;
const db = { collection: () => ({ findOne: async () => null }) } as never;

describe('сотрудник без телефона (ИИ-тестировщик 2026-11-12)', () => {
  it('у «Сотрудников» пустой телефон не пишется: уникальный sparse-индекс считает null значением', async () => {
    expect(persons.unsetEmpty).toEqual(['phone']);
    const doc = await persons.toDoc({ firstName: 'Иван', phone: '' }, true, db);
    expect(doc.phone).toBeNull();
    expect(emptyKeys(persons, doc)).toEqual(['phone']);
  });

  it('заполненный телефон и поле, которого нет в форме, не трогаются', async () => {
    expect(emptyKeys(persons, { phone: '+7 900 000-00-00' })).toEqual([]);
    expect(emptyKeys(persons, { firstName: 'Иван' })).toEqual([]);
    expect(emptyKeys({}, { phone: null })).toEqual([]);
  });
});
