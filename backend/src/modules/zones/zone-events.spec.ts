import { Types } from 'mongoose';
import { incomeNoContractText, noContract, scanLowStock, scanPassports, scanReservations } from './zone-events';
import { ZonesService } from './zones.service';

const oidn = () => new Types.ObjectId();
const NOW = new Date('2026-10-29T10:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86400000);

/** Фейковая БД: коллекция → строки; find игнорирует фильтр (проверяем логику сервиса, фильтры Mongo — в e2e). */
function fakeDb(data: Record<string, Array<Record<string, unknown>>>) {
  return { collection: (n: string) => ({
    find: () => ({ limit: () => ({ toArray: async () => data[n] ?? [] }), toArray: async () => data[n] ?? [] }),
    findOne: async () => (data[n] ?? [])[0] ?? null,
  }) } as never;
}
const rec = () => { const out: Array<{ zone: string; n: Record<string, unknown>; d: number }> = []; return { out, fn: async (zone: string, n: never, d: number) => { out.push({ zone, n, d }); } }; };

describe('СВ-11: события зон', () => {
  it('1. бронь: срок завтра — шлём, через неделю — нет, просрочена — «Просрочена»', async () => {
    const oid1 = oidn();
    const r = rec();
    const db = fakeDb({
      salesorders: [{ _id: oid1, orderNo: 'К-5', stage: 'production', shipDate: day(20) }],
      reservations: [
        { salesOrderId: oid1, groupName: 'Лист', expiresAt: day(1) },
        { salesOrderId: oid1, groupName: 'Труба', expiresAt: day(7) },
        { salesOrderId: oid1, groupName: 'Болт', expiresAt: day(-3) },
        { groupName: 'Без срока' },
      ],
    });
    expect(await scanReservations(db, r.fn as never, NOW)).toBe(2);
    expect(r.out[0].zone).toBe('stock');
    expect(r.out[0].n.text).toContain('Пора выдать по брони: Лист — заказ К-5');
    expect(r.out[1].n.text).toContain('Просрочена выдача по брони: Болт');
    expect(r.out[0].n.href).toBe(`#salesorders?open=${oid1}`);
  });
  it('1. бронь без своего срока берёт shipDate заказа; закрытый заказ — пропуск', async () => {
    const a = oidn(), b = oidn();
    const r = rec();
    const db = fakeDb({
      salesorders: [{ _id: a, orderNo: '1', stage: 'new', shipDate: day(0) }, { _id: b, orderNo: '2', stage: 'shipped', shipDate: day(0) }],
      reservations: [{ salesOrderId: a, groupName: 'X' }, { salesOrderId: b, groupName: 'Y' }],
    });
    expect(await scanReservations(db, r.fn as never, NOW)).toBe(1);
  });
  it('2. остаток: свободный ≤ минимума — шлём; в открытой заявке или выше минимума — нет', async () => {
    const m1 = oidn(), m2 = oidn(), m3 = oidn();
    const r = rec();
    const db = fakeDb({
      storageitems: [
        { _id: oidn(), name: 'Лист', materialId: m1, quantity: 10, reservedQty: 6, minQuantity: 5 },
        { _id: oidn(), name: 'Труба', materialId: m2, quantity: 2, reservedQty: 0, minQuantity: 5 },
        { _id: oidn(), name: 'Болт', materialId: m3, quantity: 50, reservedQty: 0, minQuantity: 5 },
      ],
      supplyrequests: [{ materialId: m2 }],
      materials: [{ _id: m1, unit: 'м' }],
    });
    expect(await scanLowStock(db, r.fn as never)).toBe(1);
    expect(r.out[0].n.text).toBe('Остаток ниже минимума: Лист — свободно 4 м, минимум 5');
    expect(r.out[0].d).toBe(7);
  });
  it('3. «без договора»: нет заказа или пуст contractNo', () => {
    expect(noContract(null)).toBe(true);
    expect(noContract({ contractNo: '  ' })).toBe(true);
    expect(noContract({ contractNo: 'Д-1' })).toBe(false);
    expect(incomeNoContractText(1500, 'ООО Ромашка')).toBe('Поступление 1500 ₽ от ООО Ромашка без договора — привяжите к заказу или укажите № договора');
    expect(incomeNoContractText(0)).toContain('без суммы от заказчик не указан');
  });
  it('4. паспорта: нет выпущенных и есть изделия — шлём; есть паспорт или нет изделий — нет', async () => {
    const o = oidn();
    const base = { salesorders: [{ _id: o, orderNo: 'К-9', stage: 'ready', shipDate: day(2) }] };
    let r = rec();
    expect(await scanPassports(fakeDb({ ...base, incomes: [{}] }), r.fn as never, NOW)).toBe(1);
    expect(r.out[0]).toMatchObject({ zone: 'passports', d: 3 });
    expect(r.out[0].n.text).toContain('Заказ К-9 уходит в отгрузку');
    r = rec();
    expect(await scanPassports(fakeDb({ ...base, incomes: [{}], productpassports: [{}] }), r.fn as never, NOW)).toBe(0);
    expect(await scanPassports(fakeDb({ ...base }), r.fn as never, NOW)).toBe(0);
  });
});

describe('ZonesService.notifyZone: антидубль (dedupeDays)', () => {
  const uid = '64b7f0000000000000000009';
  const make = (already: boolean) => {
    const sent: unknown[] = [];
    const filters: Array<Record<string, unknown>> = [];
    const conn = { db: { collection: () => ({ findOne: async (f: Record<string, unknown>) => { filters.push(f); return already ? { _id: 1 } : null; } }) } };
    const svc = new ZonesService({} as never, {} as never, {} as never, conn as never, { safe: async (n: unknown) => { sent.push(n); return true; } } as never);
    jest.spyOn(svc as never, 'zoneUserIds' as never).mockImplementation((async () => [uid]) as never);
    jest.spyOn(svc as never, 'workingPeople' as never).mockImplementation((async () => []) as never);
    jest.spyOn(svc as never, 'zoneNames' as never).mockImplementation((async () => new Map()) as never);
    return { svc, sent, filters };
  };
  it('уже слали по тому же href — не шлём', async () => {
    const { svc, sent } = make(true);
    const r = await svc.notifyZone('stock', { type: 'stock_below_min', text: 'x', href: '#stock?open=1' }, { dedupeDays: 7 });
    expect(r.sent).toBe(0); expect(sent).toHaveLength(0);
  });
  it('не слали — шлём; окно задаётся createdAt, Infinity — без окна', async () => {
    const a = make(false);
    await a.svc.notifyZone('stock', { type: 't', text: 'x', href: 'h' }, { dedupeDays: 7 });
    expect(a.sent).toHaveLength(1);
    expect(a.filters[0]).toMatchObject({ type: 't', href: 'h' });
    expect(a.filters[0].createdAt).toBeDefined();
    const b = make(false);
    await b.svc.notifyZone('accounting', { type: 't', text: 'x', href: 'h' }, { dedupeDays: Infinity });
    expect(b.filters[0].createdAt).toBeUndefined();
  });
  it('без dedupeDays проверки нет (прежнее поведение)', async () => {
    const { svc, sent, filters } = make(true);
    await svc.notifyZone('stock', { type: 't', text: 'x' });
    expect(sent).toHaveLength(1); expect(filters).toHaveLength(0);
  });
});
