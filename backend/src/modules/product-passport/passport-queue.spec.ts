import { buildQueue } from './passport-queue';

const NOW = new Date('2026-10-28T09:00:00Z');
const d = (s: string) => new Date(s + 'T00:00:00Z');
const order = (id: string, shipDate: string | null, extra = {}) => ({ _id: id, orderNo: id.toUpperCase(), customer: 'Заказчик', shipDate: shipDate ? d(shipDate) : null, priority: 'normal', ...extra });
const income = (id: string, orderId: string, productId: string | null = 'p1', lineNo = 1) => ({ _id: id, orderId, productId, lineNo, title: 'Урна ' + id });
const task = (incomeId: string, at = '2026-10-20') => ({ incomeId, completedAt: d(at) });

describe('очередь паспортов', () => {
  const base = { tasks: [task('i1'), task('i2')], incomes: [income('i1', 'o1'), income('i2', 'o2')], orders: [order('o1', '2026-11-05'), order('o2', '2026-10-30')], passports: [] as Array<Record<string, unknown>>, products: [{ _id: 'p1', name: 'Урна' }] };
  const ids = (r: ReturnType<typeof buildQueue>) => r.items.map((i) => i.incomeId);

  it('позиция с проектированием и без паспорта в очереди; ближе срок — выше; «горит» ≤ 3 дн.', () => {
    const r = buildQueue(base, {}, NOW);
    expect(ids(r)).toEqual(['i2', 'i1']);
    expect(r.items[0]).toMatchObject({ passportState: 'none', hot: true, productName: 'Урна' });
    expect(r.items[1].hot).toBe(false);
    expect(r.counts).toEqual({ none: 2, draft: 0, rework: 0, hot: 1 });
  });
  it('задание «В работе» попадает в строку', () => {
    const r = buildQueue({ ...base, works: [{ _id: 'w1', incomeId: 'i1', status: 'work', route: [{ name: 'Сварка' }], stepIndex: 0 }] }, {}, NOW);
    expect(r.items.find((i) => i.incomeId === 'i1')!.work).toEqual({ id: 'w1', status: 'work', currentStep: 'Сварка' });
    expect(r.items.find((i) => i.incomeId === 'i2')!.work).toBeNull();
  });
  it('без проектирования или без изделия — не попадает', () => {
    expect(ids(buildQueue({ ...base, tasks: [task('i1')] }, {}, NOW))).toEqual(['i1']);
    expect(ids(buildQueue({ ...base, incomes: [income('i1', 'o1', null), income('i2', 'o2')] }, {}, NOW))).toEqual(['i2']);
  });
  it('выпущенный паспорт убирает позицию; черновик и доработка — с подписью', () => {
    const issued = { _id: 'x1', incomeId: 'i1', status: 'issued', passportNumber: '5' };
    const draft = { _id: 'x2', incomeId: 'i2', status: 'draft', passportNumber: 'draft-x2' };
    expect(buildQueue({ ...base, passports: [issued, draft] }, {}, NOW).items).toEqual([expect.objectContaining({ incomeId: 'i2', passportState: 'draft', passportId: 'x2' })]);
    const rework = { _id: 'x3', incomeId: 'i1', status: 'issued', passportNumber: '6', readiness: 'rework' };
    expect(buildQueue({ ...base, passports: [rework] }, {}, NOW).items.find((i) => i.incomeId === 'i1')).toMatchObject({ passportState: 'rework' });
  });
  it('старый паспорт без incomeId закрывает только одну из двух одинаковых позиций', () => {
    const inp = { ...base, tasks: [task('i1'), task('i3')], incomes: [income('i1', 'o1', 'p1', 1), income('i3', 'o1', 'p1', 2)], orders: [order('o1', '2026-11-05')], passports: [{ _id: 'x1', salesOrderId: 'o1', productId: 'p1', status: 'issued', passportNumber: '5' }] };
    expect(ids(buildQueue(inp, {}, NOW))).toEqual(['i3']);
  });
  it('фильтры: просрочено, скоро, поиск; без срока — в конец', () => {
    const inp = { ...base, orders: [order('o1', null), order('o2', '2026-10-27')] };
    expect(ids(buildQueue(inp, { due: 'overdue' }, NOW))).toEqual(['i2']);
    expect(ids(buildQueue(inp, {}, NOW))).toEqual(['i2', 'i1']);
    expect(ids(buildQueue(base, { due: 'soon' }, NOW))).toEqual(['i2']);
    expect(ids(buildQueue(base, { search: 'урна i1' }, NOW))).toEqual(['i1']);
  });
});
