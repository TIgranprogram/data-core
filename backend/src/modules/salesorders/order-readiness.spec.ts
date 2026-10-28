import { EMPTY_FACTS, loadReadinessFacts, readinessChecks, readinessWarnings } from './order-readiness';

describe('готовность заказа', () => {
  const ok = { lines: 3, openDesign: 0, openRequests: 0, activeReservations: 0 };

  it('все пункты выполнены — ready', () => {
    const r = readinessChecks(ok, '21-26', 'abc');
    expect(r.ready).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(readinessWarnings(r)).toEqual([]);
  });

  it('открытые задачи и заявки — не ready, подсказки на языке менеджера', () => {
    const r = readinessChecks({ ...ok, openDesign: 2, openRequests: 1 }, '21-26', 'abc');
    expect(r.ready).toBe(false);
    expect(readinessWarnings(r)).toEqual(['Проектирование завершено: Не закончено: 2 задач', 'Все заявки получены: Ждём: 1 заявка']);
    expect(r.checks.find((c) => c.key === 'requests')!.href).toBe('#requests?q=21-26');
  });

  it('без позиций — не готов', () => {
    expect(readinessChecks(EMPTY_FACTS, 'k', 'id').ready).toBe(false);
  });

  it('факты считаются агрегацией по группам', async () => {
    const ids = [{ toString: () => 'a' }, { toString: () => 'b' }] as never[];
    const calls: string[] = [];
    const db = { collection: (c: string) => ({ aggregate: () => ({ toArray: async () => { calls.push(c); return c === 'designtasks' ? [{ _id: 'b', n: 2 }] : c === 'incomes' ? [{ _id: 'a', n: 1 }, { _id: 'b', n: 4 }] : []; } }) }) };
    const f = await loadReadinessFacts(db as never, new Map([['K1', [ids[0]]], ['K2', [ids[1]]]]));
    expect(calls.sort()).toEqual(['designtasks', 'incomes', 'reservations', 'supplyrequests']);
    expect(f.get('K1')).toEqual({ lines: 1, openDesign: 0, openRequests: 0, activeReservations: 0 });
    expect(f.get('K2')).toEqual({ lines: 4, openDesign: 2, openRequests: 0, activeReservations: 0 });
  });
});
