import { stockViewsFor } from './stock-views';

describe('Дополнительные экраны склада — только настройка просмотра', () => {
  it('директор наследует оба экрана, остальные роли ничего дополнительного не получают', () => {
    expect(stockViewsFor('director', undefined)).toEqual(['pipe', 'sheet']);
    for (const role of ['admin', 'manager', 'accountant', 'user', 'r-worker', 'unknown']) {
      expect(stockViewsFor(role, undefined)).toEqual([]);
    }
  });
  it.each([[], ['pipe'], ['sheet'], ['sheet', 'pipe']].map(configured => ({ configured })))('сохраняет явный список $configured и не отдаёт внутренний массив', ({ configured }) => {
    const result = stockViewsFor('director', configured);
    expect(result).toEqual(configured);
    expect(result).not.toBe(configured);
  });
  it.each([null, false, '', 'pipe', {}, ['wood'], ['pipe', 'unknown'], ['pipe', 'pipe'], ['pipe', 'sheet', 'pipe']].map(value => ({ value })))('повреждённая настройка $value не даёт дополнительных экранов', ({ value }) => {
    expect(stockViewsFor('director', value)).toEqual([]);
  });
});
