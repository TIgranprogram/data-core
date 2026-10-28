import { buildForecast, expectedOps, prepayPercent } from './forecast';

const T = '2026-10-21';

describe('forecast (БЗ-1): прогноз денег', () => {
  it('предоплата из формы оплаты', () => {
    expect(prepayPercent('б/р 30%')).toBe(30);
    expect(prepayPercent('50 % предоплата')).toBe(50);
    expect(prepayPercent('б/р')).toBeNull();
    expect(prepayPercent('100%')).toBeNull();
  });

  it('выплаты: неоплаченные счета — будущие в свой день, прошедшие на сегодня «просрочено»; открытые без даты — «без срока»; отменённые — нет', () => {
    const { ops, noDate } = expectedOps([
      { id: 'a', title: 'Труба', amount: 1000, company: 'СИЮ', invoiceDate: '2026-10-25', status: 'ordered' },
      { id: 'b', title: 'Болт', amount: 500, company: 'СИЮ', invoiceDate: '2026-10-20', status: 'ordered' }, // счёт не оплачен — просрочено, на сегодня
      { id: 'c', title: 'Краска', amount: 300, company: 'ССЮ', invoiceDate: null, status: 'requested' },
      { id: 'd', title: 'Отменена', amount: 900, company: 'СИЮ', invoiceDate: '2026-10-26', status: 'cancelled' },
      { id: 'e', title: 'Получено без даты', amount: 100, company: 'СИЮ', invoiceDate: null, status: 'received' },
    ], [], T);
    expect(ops.map((o) => [o.id, o.date, o.amount])).toEqual([['a', '2026-10-25', 1000], ['b', T, 500]]);
    expect(noDate.map((x) => x.id)).toEqual(['c']);
  });

  it('поступления: предоплата 30% в день заказа (прошёл — сегодня, «просрочено»), остаток — в срок; без срока — отдельно', () => {
    const { ops, noDate } = expectedOps([], [
      { id: 'i', title: 'Качели', amount: 100000, company: 'СИЮ', paymentForm: 'б/р 30%', orderDate: '2026-10-01', due: '2026-11-10' },
      { id: 'j', title: 'Горка', amount: 50000, company: 'ССЮ', paymentForm: 'б/р', due: '2026-10-28' },
      { id: 'k', title: 'Беседка', amount: 20000, company: 'СИЮ', paymentForm: 'б/р', due: null },
    ], T);
    expect(ops.map((o) => [o.id, o.date, o.amount, !!o.overdue])).toEqual([
      ['i', T, 30000, true], ['i', '2026-11-10', 70000, false], ['j', '2026-10-28', 50000, false],
    ]);
    expect(ops[0].title).toContain('просрочено');
    expect(noDate.map((x) => [x.id, x.amount])).toEqual([['k', 20000]]);
  });

  it('остаток вперёд, кассовый разрыв, итоги недели', () => {
    const { ops } = expectedOps(
      [{ id: 'a', title: 'Металл', amount: 150000, company: 'СИЮ', invoiceDate: '2026-10-23', status: 'ordered' }],
      [{ id: 'i', title: 'Заказ', amount: 200000, company: 'СИЮ', paymentForm: 'б/р', due: '2026-10-30' }], T);
    const f = buildForecast(ops, T, '2026-11-05', 100000, ['СИЮ']);
    expect(f.days[0]).toMatchObject({ date: T, opening: 100000, closing: 100000 });
    expect(f.firstGap).toBe('2026-10-23');
    expect(f.gapDays).toHaveLength(7); // 23…29 — минус 50 000, 30-го поступление
    expect(f.minBalance).toEqual({ date: '2026-10-23', amount: -50000 });
    expect(f.week).toEqual({ to: '2026-10-28', pay: 150000, receive: 0 });
    expect(f.totals.closing).toBe(150000);
  });
});

describe('forecast: частичные оплаты (К7)', () => {
  it('принятая предоплата вычитается: остаток по сроку', () => {
    const { ops } = expectedOps([], [{ id: 'i', title: 'Качели', amount: 100000, paid: 30000, company: 'СИЮ', paymentForm: 'б/р 30%', orderDate: '2026-10-01', due: '2026-11-10' }], T);
    expect(ops.map((o) => [o.date, o.amount])).toEqual([['2026-11-10', 70000]]);
  });
  it('внесено больше предоплаты — остаток уменьшается; оплачено целиком — нет в прогнозе', () => {
    const { ops } = expectedOps([], [
      { id: 'a', title: 'А', amount: 100000, paid: 50000, company: 'СИЮ', paymentForm: 'б/р 30%', orderDate: '2026-10-01', due: '2026-11-10' },
      { id: 'b', title: 'Б', amount: 1000, paid: 1000, company: 'СИЮ', due: '2026-11-10' },
    ], T);
    expect(ops.map((o) => [o.id, o.amount])).toEqual([['a', 50000]]);
  });
});
