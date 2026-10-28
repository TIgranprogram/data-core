import { numberLines, sortOrdersByEntry } from '../../common/text/production-seq';
import { shipmentNumber } from '../shipments/shipments.service';
import { checkAssign, compareProductionNo, groupKey, summarize, toProduce } from './production-orders';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('сквозная нумерация позиций заказа', () => {
  const orders = [
    { _id: 'b', createdAt: d('2026-01-01'), productionAddedAt: d('2026-03-01') },
    { _id: 'a', createdAt: d('2026-02-01') },
    { _id: 'c', createdAt: d('2026-01-05'), productionAddedAt: d('2026-04-01') },
  ];
  it('договоры — по дате входа в заказ (нет — createdAt), новые в конец', () => {
    expect(sortOrdersByEntry(orders).map((o) => o._id)).toEqual(['a', 'b', 'c']);
  });
  it('внутри договора — по lineNo, без номера — в конце; нумерация 1..N', () => {
    const lines: Record<string, Array<{ _id: string; lineNo?: number }>> = {
      a: [{ _id: 'a2', lineNo: 2 }, { _id: 'a1', lineNo: 1 }],
      b: [{ _id: 'b0' }, { _id: 'b1', lineNo: 1 }],
      c: [{ _id: 'c1', lineNo: 1 }],
    };
    const m = numberLines(orders, (id) => lines[id]);
    expect([...m.entries()].sort((x, y) => x[1] - y[1])).toEqual([['a1', 1], ['a2', 2], ['b1', 3], ['b0', 4], ['c1', 5]]);
  });
});

describe('«К производству»', () => {
  it('одинаковое изделие суммируется, разные единицы — нет; без изделия — по нормализованному названию', () => {
    const rows = toProduce([
      { seqNo: 1, title: 'Лавочка  Ёлка', unit: 'шт', qty: 2 },
      { seqNo: 2, title: 'лавочка елка', unit: 'шт', qty: 3 },
      { seqNo: 3, title: 'Лавочка елка', unit: 'м', qty: 1 },
      { seqNo: 4, title: 'Урна', productId: 'p1', productName: 'Урна У-1', unit: 'шт', qty: 4 },
      { seqNo: 5, title: 'Урна (иначе названа)', productId: 'p1', unit: 'шт', qty: 1 },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ qty: 5, unit: 'шт', seqNos: [1, 2] });
    expect(rows[1]).toMatchObject({ qty: 1, unit: 'м', seqNos: [3] });
    expect(rows[2]).toMatchObject({ productId: 'p1', title: 'Урна У-1', qty: 5, seqNos: [4, 5] });
  });
});

describe('этап и срок заказа', () => {
  it('срок — самый ранний, этап — самый отстающий, разные этапы помечаются', () => {
    const s = summarize([
      { stage: 'ready', shipDate: d('2026-06-10'), priority: 'normal' },
      { stage: 'production', productionDeadline: d('2026-05-01'), priority: 'urgent' },
      { stage: 'cancelled' },
    ]);
    expect(s).toMatchObject({ stage: 'production', stagesDiffer: true, priority: 'urgent' });
    expect(s.deadline).toEqual(d('2026-05-01'));
  });
  it('все договоры на одном этапе — не «разные»; все отменены — отменён', () => {
    expect(summarize([{ stage: 'new' }, { stage: 'new' }])).toMatchObject({ stage: 'new', stagesDiffer: false, deadline: null });
    expect(summarize([{ stage: 'cancelled' }]).stage).toBe('cancelled');
  });
});

describe('ключ, сортировка, номер отгрузки', () => {
  it('ключ — № заказа, нет — id договора', () => {
    expect(groupKey({ _id: 'x1', productionNo: ' 21-26 ' })).toBe('21-26');
    expect(groupKey({ _id: 'x1' })).toBe('x1');
  });
  it('№ заказа: год, затем N числом; без № — в конце в любом направлении', () => {
    const asc = ['5-27', '', '10-26', '9-26'].sort((a, b) => compareProductionNo(a, b, 1));
    expect(asc).toEqual(['9-26', '10-26', '5-27', '']);
    const desc = ['5-27', '', '10-26', '9-26'].sort((a, b) => compareProductionNo(a, b, -1));
    expect(desc).toEqual(['5-27', '10-26', '9-26', '']);
  });
  it('номер отгрузки: с № заказа — ОТГ-<заказ>-<договор>-<n>, без — ОТГ-<договор>-<n>', () => {
    expect(shipmentNumber('21-26', '109-П', 2)).toBe('ОТГ-21-26-109-П-2');
    expect(shipmentNumber(undefined, '109-П', 1)).toBe('ОТГ-109-П-1');
  });
});

describe('привязка договоров к заказу', () => {
  it('занятые и несуществующие находятся', () => {
    const r = checkAssign(['a', 'b', 'c'], [{ _id: 'a' }, { _id: 'b', productionNo: '5-26' }]);
    expect(r.missing).toEqual(['c']);
    expect(r.taken).toEqual([{ id: 'b', productionNo: '5-26' }]);
  });
});
