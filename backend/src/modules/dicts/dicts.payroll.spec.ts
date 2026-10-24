import { hidePayroll } from './dicts.payroll';

/** SK-8d: «Сотрудники» без оплаты, если «ФОТ» закрыт. */
describe('hidePayroll', () => {
  const fields = [{ key: 'firstName' }, { key: 'salaryKind' }, { key: 'salaryRate' }];

  it('список: строки и описание формы без salaryKind / salaryRate', () => {
    const r = hidePayroll({ items: [{ id: '1', name: 'Иван', salaryKind: 'month', salaryRate: 100 }], total: 1, dict: { key: 'persons', fields } });
    expect(r.items[0]).toEqual({ id: '1', name: 'Иван' });
    expect(r.dict.fields.map((f) => f.key)).toEqual(['firstName']);
    expect(r.total).toBe(1);
  });

  it('карточка: строка и dictInfo.fields без оплаты', () => {
    const r = hidePayroll({ id: '1', salaryRate: 100, related: [], dictInfo: { title: 'Сотрудники', fields } }) as Record<string, unknown>;
    expect(r.salaryRate).toBeUndefined();
    expect((r.dictInfo as { fields: unknown[] }).fields).toHaveLength(1);
  });
});
