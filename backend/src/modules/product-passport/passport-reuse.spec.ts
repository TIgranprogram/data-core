import { Types } from 'mongoose';
import { takeOverNumbers } from './passport-reuse';

/** C060: позиция договора + изделие — один номер; модель — на памяти. */
function fake(rows: Array<Record<string, unknown>>) {
  const upd: Array<{ q: Record<string, unknown>; u: Record<string, unknown> }> = [];
  const chain = <T>(v: T) => { const c: Record<string, unknown> = {}; for (const m of ['setOptions', 'sort', 'limit', 'session', 'lean']) c[m] = () => c; c.exec = async () => v; return c; };
  const model = {
    find: (q: Record<string, unknown>) => chain(rows.filter((r) => String(r.incomeId) === String(q.incomeId) && String(r.productId) === String(q.productId) && r.status === q.status)),
    countDocuments: (q: { passportNumber: RegExp }) => chain(rows.filter((r) => q.passportNumber.test(String(r.passportNumber))).length),
    updateOne: (q: Record<string, unknown>, u: Record<string, unknown>) => { upd.push({ q, u }); return chain(null); },
  };
  return { model: model as never, upd };
}
const income = new Types.ObjectId(); const product = new Types.ObjectId();
const annulled = (no: string, extra: Record<string, unknown> = {}) => ({ _id: new Types.ObjectId(), incomeId: income, productId: product, status: 'annulled', passportNumber: no, productCode: '77', warrantyCode: '202611-' + no, ...extra });

describe('takeOverNumbers (C060)', () => {
  it('перепечатка: берёт номер, номер изделия и талон аннулированного паспорта той же позиции и изделия', async () => {
    const prev = annulled('551');
    const { model, upd } = fake([prev]);
    const r = await takeOverNumbers(model, { incomeId: income, productId: product });
    expect(r).toEqual({ passportNumber: '551', passportNo: 551, productCode: '77', warrantyCode: '202611-551' });
    expect(upd).toHaveLength(1);
    expect(upd[0].u).toMatchObject({ $set: { passportNumber: '551~1', annulledNumbers: { passportNumber: '551', productCode: '77', warrantyCode: '202611-551' } }, $unset: { productCode: '', warrantyCode: '' } });
  });
  it('второй раз подряд: суффикс растёт, прежняя цепочка не трогается', async () => {
    const { model, upd } = fake([annulled('551~1', { annulledAt: 1 }), annulled('551', { annulledAt: 2 })]);
    await takeOverNumbers(model, { incomeId: income, productId: product });
    expect(upd[0].u).toMatchObject({ $set: { passportNumber: '551~2' } });
  });
  it('другая позиция или другое изделие — новый номер из счётчика (null)', async () => {
    const { model, upd } = fake([annulled('551')]);
    expect(await takeOverNumbers(model, { incomeId: new Types.ObjectId(), productId: product })).toBeNull();
    expect(await takeOverNumbers(model, { incomeId: income, productId: new Types.ObjectId() })).toBeNull();
    expect(await takeOverNumbers(model, { productId: product })).toBeNull();
    expect(upd).toHaveLength(0);
  });
  it('нет аннулированного паспорта (первый выпуск) — null', async () => {
    expect(await takeOverNumbers(fake([]).model, { incomeId: income, productId: product })).toBeNull();
  });
});
