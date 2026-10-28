/* eslint-disable @typescript-eslint/no-explicit-any */
import { Types } from 'mongoose';
import { loadOrderHistory } from './order-history';

const oid = new Types.ObjectId();
const inc = new Types.ObjectId();
const t = (s: string) => new Date(s);

/** Минимальная замена db: коллекция → массив документов; find(...).sort().limit().toArray(). */
function fakeDb(data: Record<string, any[]>) {
  return { collection: (n: string) => ({ find: () => { const c: any = { sort: () => c, limit: () => c, toArray: async () => data[n] ?? [] }; return c; } }) } as any;
}
const base = {
  incomes: [{ _id: inc, title: 'Урна', lineNo: 1 }],
  shipments: [{ _id: new Types.ObjectId(), number: 'ОТГ-5-1', date: t('2026-10-30'), createdAt: t('2026-10-30T10:00:00Z'), whoName: 'Анна', reason: 'часть готова', lines: [{ title: 'Урна', qty: 5, unit: 'шт' }] }],
};
const acc = (money: boolean) => ({ money, design: true, passports: true, stock: true });
const logs = [
  { entityType: 'Income', entityId: inc, action: 'income.updated', userName: 'Олег', createdAt: t('2026-10-29T09:00:00Z'), details: { after: { title: 'Урна', lineNo: 1, amount: 900, paidDate: '2026-10-29T00:00:00.000Z', status: 'paid' } } },
  { entityType: 'Income', entityId: inc, action: 'income.created', userName: 'Олег', createdAt: t('2026-10-28T09:00:00Z'), details: { after: { title: 'Урна', lineNo: 1, amount: 900 } } },
];

describe('история заказа', () => {
  it('отгрузка: кто, сколько, почему; фильтр по типу и поиску', async () => {
    const r = await loadOrderHistory(fakeDb(base), oid, { type: 'shipment', search: 'урна' }, acc(false));
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ type: 'shipment', who: 'Анна' });
    expect(r.items[0].text).toContain('Урна — 5 шт');
    expect(r.items[0].text).toContain('Причина: часть готова');
    expect((await loadOrderHistory(fakeDb(base), oid, { type: 'shipment', search: 'кресло' }, acc(false))).items).toHaveLength(0);
  });
  it('оплата и суммы — только денежным ролям', async () => {
    const d = fakeDb({ ...base, auditlogs: logs });
    const money = await loadOrderHistory(d, oid, {}, acc(true));
    expect(money.items.some((i) => i.type === 'payment' && i.text.includes('Дата оплаты'))).toBe(true);
    const plain = await loadOrderHistory(d, oid, {}, acc(false));
    expect(plain.items.some((i) => i.type === 'payment')).toBe(false);
    expect(JSON.stringify(plain.items)).not.toMatch(/900|оплач/i);
  });
  it('новые сверху; закрытый раздел склада скрыт', async () => {
    const full = { ...base, auditlogs: logs, stockmovements: [{ _id: new Types.ObjectId(), type: 'out', date: t('2026-11-01'), qty: 2, materialId: null }] };
    const r = await loadOrderHistory(fakeDb(full), oid, {}, acc(true));
    expect(r.items[0].type).toBe('stock');
    const at = r.items.map((i) => +new Date(i.at));
    expect(at).toEqual([...at].sort((a, b) => b - a));
    expect((await loadOrderHistory(fakeDb(full), oid, {}, { ...acc(true), stock: false })).items.some((i) => i.type === 'stock')).toBe(false);
  });
});
