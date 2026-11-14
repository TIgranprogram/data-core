import { assertRevisionRemovable, revisionRows } from './passport-revisions';

const doc = { revision: 3, updatedAt: new Date('2026-11-14'), revisions: [
  { revision: 1, at: new Date('2026-11-01'), by: 'u1', data: { name: 'a' } },
  { revision: 2, at: new Date('2026-11-05'), by: 'u2', data: { name: 'b' } },
] };

describe('версии паспорта', () => {
  it('список: текущая сверху и помечена, без снимков', () => {
    const rows = revisionRows(doc as never, new Map([['u1', 'Иван']]));
    expect(rows.map((r) => [r.revision, r.current, r.byName])).toEqual([[3, true, null], [2, false, null], [1, false, 'Иван']]);
    expect(JSON.stringify(rows)).not.toContain('"data"');
  });
  it('без правок версий нет', () => expect(revisionRows({ revision: 1 } as never, new Map())).toEqual([]));
  it('прежнюю удалить можно', () => expect(() => assertRevisionRemovable(doc as never, 1)).not.toThrow());
  it('текущую — 409', () => expect(() => assertRevisionRemovable(doc as never, 3)).toThrow('Текущую версию'));
  it('несуществующую — 404, мусор — 400', () => {
    expect(() => assertRevisionRemovable({ ...doc, revisions: [doc.revisions[0]] } as never, 2)).toThrow('не найдена');
    expect(() => assertRevisionRemovable(doc as never, NaN)).toThrow('целое');
  });
});
