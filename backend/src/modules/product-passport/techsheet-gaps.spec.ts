import { techSheetGaps } from './techsheet-gaps';
import { buildFillQueue } from './product-fill-queue';

const full = { dimensions: { length: 1, width: 1, height: 1 }, weightKg: 5, purpose: 'Игры', installation: 'бетон', composition: [{}], materialsSpec: { rows: [{ materialId: 'm', partIds: ['p'] }] } };

describe('C114 D-S: пробелы техописания', () => {
  it('всё заполнено — пусто', () => expect(techSheetGaps(full)).toEqual([]));
  it('нет материалов — materials; строки без частей — parts', () => {
    expect(techSheetGaps({ ...full, materialsSpec: { rows: [] } }).map((g) => g.key)).toEqual(['materials']);
    expect(techSheetGaps({ ...full, materialsSpec: { rows: [{ materialId: 'm', partIds: [] }] } }).map((g) => g.key)).toEqual(['parts']);
  });
  it('габариты, вес, назначение, монтаж', () => {
    expect(techSheetGaps({ materialsSpec: full.materialsSpec }).map((g) => g.key)).toEqual(['dimensions', 'weightKg', 'purpose', 'installation']);
  });
  it('очередь: с withTechsheet добавляются материалы и части, scope меняется, дублей полей нет', () => {
    const q = buildFillQueue({ gaps: [], product: { ...full, materialsSpec: { rows: [{ materialId: 'm', partIds: [] }] } }, inOrders: false, hasIssued: false, withTechsheet: true });
    expect(q.scope).toBe('passport+techsheet');
    expect(q.items.map((i) => i.key)).toEqual(['parts']);
    expect(q).toMatchObject({ done: 4, total: 5 });
    expect(buildFillQueue({ gaps: [], product: {}, inOrders: false, hasIssued: false }).scope).toBe('passport');
  });
});
