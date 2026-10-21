import { beforeOf, classify, cleanArticle, rollbackFor, updateFor, type MatIn } from './article-clean';

const M = (id: string, name: string, article: string, extra: Partial<MatIn> = {}): MatIn => ({ _id: id, name, article, ...extra });

describe('article-clean (АР-Ч): чистка автоартикулов', () => {
  it('проверка артикула: пусто, «—», СКЛ-… — непригодны; пробелы убираются', () => {
    expect(cleanArticle('  ILT57,2 ')).toBe('ILT57,2');
    expect(cleanArticle('6205   2RS')).toBe('6205 2RS');
    for (const bad of ['', '—', '-', 'СКЛ-2026-001', null]) expect(cleanArticle(bad)).toBeNull();
  });

  it('группы: A по связи, B по названию, C несколько, D занят другой позицией / нужен двоим, E правилась или свой', () => {
    const mats = [
      M('1', 'Микрометр Тундра', 'СКЛ-2026-001'),
      M('2', 'Заглушка 57.2', 'СКЛ-2026-008'),
      M('3', 'Пружина', 'СКЛ-2026-018'),
      M('4', 'Сиденье Forto, 465', 'СФБОЧ-КсОК'),
      M('5', 'Сиденье Forto без подвесов', 'СКЛ-2026-224'),
      M('6', 'Скоба', 'MY-1'),
      M('7', 'Болт правленый', 'СКЛ-2026-030', { editedInApp: true }),
      M('8', 'Шайба А', 'СКЛ-2026-040'), M('9', 'Шайба Б', 'СКЛ-2026-041'),
      M('10', 'Удалённая', 'СКЛ-2026-050', { deletedAt: new Date() }),
    ];
    const reqs = [
      { materialId: '1', article: '90664165', num: 1 },
      { title: 'заглушка  57.2', article: 'ILT57,2', num: 2 },
      { materialId: '3', article: 'С-20', num: 3 }, { materialId: '3', article: 'С-21', num: 4 },
      { materialId: '4', article: 'СФБОЧ-КсОК', num: 14 },
      { materialId: '5', article: 'СФБОЧ-КсОК', num: 103 },
      { materialId: '6', article: 'OTHER', num: 5 },
      { materialId: '7', article: 'X-7', num: 6 },
      { materialId: '8', article: 'SAME', num: 7 }, { materialId: '9', article: 'SAME', num: 8 },
      { materialId: '10', article: 'DEL', num: 9 },
    ];
    const g = Object.fromEntries(classify(mats, reqs).map((r) => [r.id, r.group]));
    expect(g).toEqual({ 1: 'A', 2: 'B', 3: 'C', 5: 'D', 6: 'E', 7: 'E', 8: 'D', 9: 'D' });
    expect(classify(mats, reqs).find((r) => r.id === '5')!.pair).toBe('Сиденье Forto, 465');
    expect(Object.fromEntries(classify(mats, reqs, { includeEdited: true }).map((r) => [r.id, r.group]))['7']).toBe('A');
  });

  it('запись: новый артикул, старый СКЛ-… → внутренний код, sku только если пуст; условие «старый артикул»', () => {
    const m = M('1', 'Микрометр', 'СКЛ-2026-001', { sku: 'INS-1' });
    const u = updateFor({ id: '1', name: 'Микрометр', now: 'СКЛ-2026-001', next: '90664165', group: 'A', source: '', reason: '' }, m);
    expect(u).toMatchObject({ id: '1', oldArticle: 'СКЛ-2026-001', set: { article: '90664165', internalArticle: 'СКЛ-2026-001' } });
    expect(u.set.sku).toBeUndefined();
    expect(updateFor({ id: '2', name: '', now: '', next: 'Z', group: 'A', source: '', reason: '' }, M('2', '', 'СКЛ-2026-002')).set.sku).toBe('СКЛ-2026-002');
  });

  it('идемпотентность: после записи позиция больше не попадает в чистку', () => {
    const after = [M('1', 'Микрометр', '90664165', { internalArticle: 'СКЛ-2026-001' })];
    expect(classify(after, [{ materialId: '1', article: '90664165' }])).toEqual([]);
  });

  it('откат: возвращает прежние значения, убирает добавленное, условие — артикул всё ещё новый', () => {
    const before = beforeOf(M('1', 'Микрометр', 'СКЛ-2026-001'));
    const r = rollbackFor(before, M('1', 'Микрометр', '90664165', { internalArticle: 'СКЛ-2026-001', sku: 'СКЛ-2026-001' }));
    expect(r).toMatchObject({ id: '1', expectArticle: '90664165', set: { article: 'СКЛ-2026-001' }, unset: { internalArticle: '', sku: '' } });
  });
});
