import { diffSnapshots, simple, withChanges } from './record-history';

describe('record-history (И.1): «было → стало» из соседних снимков', () => {
  it('меняется поле — было и стало; служебные поля и списки не показываем', () => {
    const ch = diffSnapshots({ title: 'Болт М8', qty: 10, updatedAt: '1', photos: [1] }, { title: 'Болт М8', qty: 12, updatedAt: '2', photos: [1, 2] });
    expect(ch).toEqual([{ field: 'qty', from: 10, to: 12 }]);
  });

  it('стёртое значение — «стало» null; объект показывается названием', () => {
    expect(diffSnapshots({ notes: 'срочно', supplier: { name: 'Металлбаза' } }, { notes: '', supplier: { name: 'Крепёж' } }))
      .toEqual([{ field: 'notes', from: 'срочно', to: null }, { field: 'supplier', from: 'Металлбаза', to: 'Крепёж' }]);
  });

  it('деньги скрыты от ролей без денег', () => {
    expect(diffSnapshots({ priceHint: 100, qty: 1 }, { priceHint: 200, qty: 2 }, false)).toEqual([{ field: 'qty', from: 1, to: 2 }]);
  });

  it('первый снимок — только заполненные поля без «было»', () => {
    expect(diffSnapshots(null, { title: 'Гайка', qty: 0, paid: false, notes: null })).toEqual([{ field: 'title', from: null, to: 'Гайка' }, { field: 'qty', from: null, to: 0 }]);
  });

  it('withChanges: журнал «сначала новые» — сравнение по времени, порядок сохраняется', () => {
    const items = [
      { action: 'x.updated', details: { after: { status: 'ordered', qty: 5 } } },
      { action: 'x.updated', details: { after: { status: 'requested', qty: 5 } } },
      { action: 'x.created', details: { after: { status: 'requested', qty: 4 } } },
    ];
    const r = withChanges(items, true);
    expect(r[0].changes).toEqual([{ field: 'status', from: 'requested', to: 'ordered' }]);
    expect(r[1].changes).toEqual([{ field: 'qty', from: 4, to: 5 }]);
    expect(r[2].first).toBe(true);
  });

  it('simple: дата строкой, список — не сравнивается', () => {
    expect(simple(new Date('2026-10-21T00:00:00Z'))).toBe('2026-10-21T00:00:00.000Z');
    expect(simple([1])).toBeUndefined();
  });
});
