import { adjustedLines, type LiveRequest } from './invoice-lines';

const paidAt = new Date('2026-03-10T10:00:00Z');
const later = new Date('2026-03-12T10:00:00Z');
const snapshot = { paidAt, lines: [{ requestId: 'r1', lineAmount: 100, title: 'А' }, { requestId: 'r2', lineAmount: 50, title: 'Б' }] };
const live = (id: string, priceHint: number, extra: Partial<LiveRequest> = {}): [string, LiveRequest] => [id, { _id: id, invoiceId: 'inv', priceHint, status: 'ordered', ...extra }];
const amounts = (l: Array<Record<string, unknown>>) => l.map((x) => [x.requestId, x.lineAmount]);

describe('adjustedLines (C084 B6)', () => {
  it('без корректировок — снимок как есть', () => {
    expect(amounts(adjustedLines('inv', snapshot, [], new Map()))).toEqual([['r1', 100], ['r2', 50]]);
  });
  it('оплатили, потом уменьшили сумму строки — берётся новая сумма', () => {
    const reqs = new Map([live('r1', 60), live('r2', 50)]);
    expect(amounts(adjustedLines('inv', snapshot, [{ at: later, requestIds: ['r1'] }], reqs))).toEqual([['r1', 60], ['r2', 50]]);
  });
  it('строку убрали из счёта — её нет в расходе', () => {
    const reqs = new Map([live('r1', 100), live('r2', 50, { invoiceId: undefined })]);
    expect(amounts(adjustedLines('inv', snapshot, [{ at: later, requestIds: ['r2'] }], reqs))).toEqual([['r1', 100]]);
  });
  it('строку добавили после оплаты — входит с суммой заявки', () => {
    const reqs = new Map([live('r1', 100), live('r2', 50), live('r3', 25, { title: 'В', categoryId: 'c' })]);
    const out = adjustedLines('inv', snapshot, [{ at: later, requestIds: ['r3'] }], reqs, '№7');
    expect(amounts(out)).toEqual([['r1', 100], ['r2', 50], ['r3', 25]]);
    expect(out[2]).toMatchObject({ title: 'В', categoryId: 'c', invoiceNo: '№7' });
  });
  it('корректировки до оплаты (до повторной оплаты после сторно) снимок не трогают', () => {
    const reqs = new Map([live('r1', 1)]);
    expect(amounts(adjustedLines('inv', snapshot, [{ at: new Date('2026-03-01T00:00:00Z'), requestIds: ['r1'] }], reqs))).toEqual([['r1', 100], ['r2', 50]]);
  });
  it('отменённая и удалённая заявки выпадают', () => {
    const reqs = new Map([live('r1', 100, { status: 'cancelled' }), live('r2', 50, { deletedAt: new Date() })]);
    expect(adjustedLines('inv', snapshot, [{ at: later, requestIds: ['r1', 'r2'] }], reqs)).toEqual([]);
  });
});
