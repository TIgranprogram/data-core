import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MyTasksService } from './my-tasks.service';
import { buildTasks, cleanReason, clickTime, deferDate, ownStepFilter, stepState, TASK_ITEM_KEYS } from './my-tasks';

const oid = () => new Types.ObjectId();
const me = oid(), other = oid(), wt = oid(), part = oid(), incomeId = oid();
const now = new Date('2026-11-08T09:00:00Z');
const incomes = new Map([[String(incomeId), { _id: incomeId, title: 'Навес Н-1', orderNo: '2026-14', qty: 2, shipDate: new Date('2026-11-20T00:00:00Z'), unitPrice: 9999, amount: 19998 }]]);
const typeNames = new Map([[String(wt), 'Сварка']]);
const plan = (steps: Array<Record<string, unknown>>) => ({ _id: oid(), incomeId, rev: 7, parts: [{ _id: part, name: 'Стойки' }], steps });
const step = (extra: Record<string, unknown> = {}) => ({ _id: oid(), workTypeId: wt, partRowId: part, hours: 1.5, assigneeId: me, checked: true, ...extra });

describe('Мои задания: список (C050)', () => {
  it('приходят только шаги этого сотрудника; чужие и без исполнителя — нет', () => {
    const mine = step(), theirs = step({ assigneeId: other }), nobody = step({ assigneeId: undefined });
    const r = buildTasks([plan([mine, theirs, nobody])], me, { incomes, typeNames, now });
    expect(r.map((t) => t.stepId)).toEqual([String(mine._id)]);
  });

  it('в ответе ровно явный список полей: ни денег, ни ставок, ни rev, ни ссылок на людей', () => {
    const [t] = buildTasks([plan([step({ plan: { start: new Date('2026-11-09T00:00:00Z'), end: new Date('2026-11-10T00:00:00Z') } })])], me, { incomes, typeNames, now });
    expect(Object.keys(t).sort()).toEqual([...TASK_ITEM_KEYS].sort());
    expect(t).toMatchObject({ title: 'Навес Н-1', partName: 'Стойки', workTypeName: 'Сварка', orderNo: '2026-14', due: '2026-11-20', planStart: '2026-11-09', normHours: 3, state: 'waiting' });
    expect(JSON.stringify(t)).not.toMatch(/unitPrice|amount|salary|9999|assigneeId|"rev"/);
  });

  it('состояния: ждёт, в работе, отложено, проблема, готово', () => {
    const t = new Date('2026-11-08T06:00:00Z');
    expect(stepState({})).toBe('waiting');
    expect(stepState({ startedAt: t })).toBe('working');
    expect(stepState({ startedAt: t, status: 'deferred' })).toBe('deferred');
    expect(stepState({ startedAt: t, status: 'problem' })).toBe('problem');
    expect(stepState({ startedAt: t, finishedAt: t, status: 'problem' })).toBe('done');
  });

  it('готовое старше суток не показывается, свежее — да; в работе — первым', () => {
    const old = step({ startedAt: new Date('2026-11-05T06:00:00Z'), finishedAt: new Date('2026-11-05T08:00:00Z') });
    const fresh = step({ startedAt: new Date('2026-11-08T06:00:00Z'), finishedAt: new Date('2026-11-08T08:00:00Z') });
    const work = step({ startedAt: new Date('2026-11-08T07:00:00Z') });
    const wait = step();
    const r = buildTasks([plan([old, fresh, wait, work])], me, { incomes, typeNames, now });
    expect(r.map((t) => t.state)).toEqual(['working', 'waiting', 'done']);
  });

  it('позиция удалена или вид работ удалён — задания нет', () => {
    expect(buildTasks([plan([step()])], me, { incomes: new Map(), typeNames, now })).toEqual([]);
    expect(buildTasks([plan([step()])], me, { incomes, typeNames: new Map(), now })).toEqual([]);
  });

  it('причина и «на когда» отложенного доходят до экрана', () => {
    const [t] = buildTasks([plan([step({ startedAt: now, status: 'deferred', statusReason: 'Нет материала', deferUntil: new Date('2026-11-09T00:00:00Z') })])], me, { incomes, typeNames, now });
    expect(t).toMatchObject({ state: 'deferred', reason: 'Нет материала', deferUntil: '2026-11-09' });
  });
});

describe('Мои задания: правила действий (C050)', () => {
  it('фильтр «своё»: план жив, шаг совпадает по id и исполнителю', () => {
    const p = oid(), s = oid();
    expect(ownStepFilter(p, s, me, { finishedAt: { $exists: false } })).toEqual({ _id: p, deletedAt: null, steps: { $elemMatch: { _id: s, assigneeId: me, finishedAt: { $exists: false } } } });
  });

  it('время нажатия с телефона: свежее принимается, из будущего и старше суток — серверное', () => {
    expect(clickTime('2026-11-08T08:30:00Z', now).toISOString()).toBe('2026-11-08T08:30:00.000Z');
    expect(clickTime('2026-11-08T12:00:00Z', now)).toBe(now);
    expect(clickTime('2026-11-01T08:00:00Z', now)).toBe(now);
    expect(clickTime(undefined, now)).toBe(now);
  });

  it('причина обязательна, до 200 знаков; «на когда»: пусто — завтра, прошлое — 400', () => {
    expect(() => cleanReason('  ')).toThrow(BadRequestException);
    expect(() => cleanReason('x'.repeat(201))).toThrow(/200/);
    expect(cleanReason(' Нет материала ')).toBe('Нет материала');
    expect(deferDate(undefined, now).toISOString()).toBe('2026-11-09T00:00:00.000Z');
    expect(deferDate('2026-11-12', now).toISOString()).toBe('2026-11-12T00:00:00.000Z');
    expect(() => deferDate('2026-11-01', now)).toThrow(/сегодня или позже/);
  });
});

/** Память вместо Mongo: один план; журнал записей — чтобы проверить, что именно пишется и с каким фильтром. */
function fake(opts: { person: Types.ObjectId | null; found: boolean; busy?: boolean }) {
  const writes: Array<{ filter: Record<string, unknown>; update: Record<string, any> }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const s = step({ _id: sid });
  const doc = plan([s]);
  const db = {
    collection: (name: string) => ({
      findOne: async () => (name === 'persons' ? (opts.person ? { _id: opts.person } : null) : opts.found ? doc : null),
      find: () => ({ limit: () => ({ toArray: async () => [] }), toArray: async () => (name === 'incomes' ? [incomes.get(String(incomeId))] : name === 'worktypes' ? [{ _id: wt, name: 'Сварка' }] : []) }),
      countDocuments: async () => (opts.busy ? 1 : 0),
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => { writes.push({ filter, update }); return { matchedCount: 1 }; },
    }),
  };
  const facts = { recordStep: jest.fn(async () => undefined) };
  const svc = new MyTasksService({ db } as never, facts as never);
  return { svc, writes, facts, doc };
}
const sid = oid();

describe('Мои задания: сервис (C050)', () => {
  const user = String(oid());

  it('вход не привязан к сотруднику — список пуст с linked: false, действие — 403', async () => {
    const f = fake({ person: null, found: true });
    expect(await f.svc.list(user)).toEqual({ linked: false, items: [] });
    await expect(f.svc.act(user, String(oid()), String(sid), 'start', {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.writes).toEqual([]);
  });

  it('чужой шаг (фильтр «своё» ничего не нашёл) — 403 и ни одной записи', async () => {
    const f = fake({ person: me, found: false });
    await expect(f.svc.act(user, String(oid()), String(sid), 'finish', {})).rejects.toThrow(/назначено не вам/);
    expect(f.writes).toEqual([]);
  });

  it('«Начал»: запись только в свой шаг через steps.$, rev и updatedAt не меняются', async () => {
    const f = fake({ person: me, found: true });
    await f.svc.act(user, String(oid()), String(sid), 'start', {});
    expect(f.writes.length).toBeGreaterThan(0);
    for (const w of f.writes) {
      expect(JSON.stringify(w.filter)).toContain('assigneeId');
      expect(Object.keys(w.update).every((k) => k === '$set' || k === '$unset')).toBe(true);
      expect(JSON.stringify(w.update)).not.toMatch(/rev|updatedAt|\$inc/);
      expect(Object.keys({ ...w.update.$set, ...w.update.$unset }).every((k) => k.startsWith('steps.$.'))).toBe(true);
    }
    expect(f.writes[0].update.$set).toHaveProperty(['steps.$.startedAt']);
  });

  it('второе «Начал», пока идёт другое задание — 409 «Сначала закончите текущее»', async () => {
    const f = fake({ person: me, found: true, busy: true });
    await expect(f.svc.act(user, String(oid()), String(sid), 'start', {})).rejects.toBeInstanceOf(ConflictException);
    expect(f.writes).toEqual([]);
  });

  it('«Закончил»: пишет конец и факт-часы шага', async () => {
    const f = fake({ person: me, found: true });
    await f.svc.act(user, String(oid()), String(sid), 'finish', {});
    expect(f.writes.some((w) => 'steps.$.finishedAt' in (w.update.$set ?? {}))).toBe(true);
    expect(f.facts.recordStep).toHaveBeenCalledTimes(1);
  });

  it('«Отложить» и «Проблема» без причины — 400, с причиной пишут статус', async () => {
    const f = fake({ person: me, found: true });
    await expect(f.svc.act(user, String(oid()), String(sid), 'defer', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.svc.act(user, String(oid()), String(sid), 'problem', {})).rejects.toBeInstanceOf(BadRequestException);
    await f.svc.act(user, String(oid()), String(sid), 'defer', { reason: 'Нет материала' });
    expect(f.writes[0].update.$set).toMatchObject({ 'steps.$.status': 'deferred', 'steps.$.statusReason': 'Нет материала' });
    await f.svc.act(user, String(oid()), String(sid), 'problem', { reason: 'Поломка' });
    expect(f.writes[1].update.$set).toMatchObject({ 'steps.$.status': 'problem', 'steps.$.statusReason': 'Поломка' });
  });
});
