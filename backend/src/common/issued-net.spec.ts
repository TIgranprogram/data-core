import { netIssuedByLine } from './issued-net';

const L = 'line1', M = 'mat1';
const mv = (o: Record<string, unknown>) => ({ type: 'out', qty: 1, materialId: M, salesOrderLineId: L, ...o });

describe('netIssuedByLine: выдано под позицию', () => {
  it('выдачи складываются', () => expect(netIssuedByLine([mv({ qty: 5 }), mv({ qty: 3 })])).toEqual([{ salesOrderLineId: L, materialId: M, issued: 8, returned: 0, net: 8 }]));
  it('возврат вычитается', () => {
    const r = netIssuedByLine([mv({ qty: 10 }), mv({ type: 'in', isReturn: true, qty: 4 })]);
    expect(r).toEqual([{ salesOrderLineId: L, materialId: M, issued: 10, returned: 4, net: 6 }]);
  });
  it('отменённое и сами отмены не считаются', () => {
    const r = netIssuedByLine([mv({ qty: 10 }), mv({ qty: 7, cancelledAt: new Date() }), mv({ type: 'in', isReturn: true, qty: 2, cancelledAt: new Date() }), mv({ type: 'in', qty: 7, cancelOf: 'x' })]);
    expect(r[0].net).toBe(10);
  });
  it('приход без возврата и выдача без позиции не считаются', () => expect(netIssuedByLine([mv({ type: 'in', qty: 9 }), mv({ salesOrderLineId: undefined })])).toEqual([]));
  it('разные материалы и позиции — отдельные строки; дроби без хвостов', () => {
    const r = netIssuedByLine([mv({ qty: 0.1 }), mv({ qty: 0.2 }), mv({ materialId: 'm2', qty: 1 }), mv({ salesOrderLineId: 'l2', qty: 2 })]);
    expect(r).toHaveLength(3);
    expect(r[0].net).toBe(0.3);
  });
});
