import request from 'supertest';
import { DiscoveryService } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { MONEY_FIELDS } from '../../src/common/roles-hierarchy';

/** Ключи, которых рабочий не должен видеть нигде: деньги + часы к оплате + ставки + контакты других людей. */
const FORBIDDEN_KEYS = [...MONEY_FIELDS, 'factHours', 'salaryKind', 'phone', 'email'];

/** Все ключи JSON рекурсивно. */
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
  return out;
}

/**
 * «Мои задания» (C050): рабочий видит только свои шаги, без денег; чужой шаг — 403; «Начал/Закончил» не двоят факт-часы
 * и не меняют rev плана; роль «Рабочий» не открывает чужие разделы и не отдаёт контакты и ставки сотрудников.
 * НЕ запускался (нет .env / Docker при написании).
 */
describe('Мои задания (рабочий)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);
  let worker = '', stranger = '';
  let planId = '', myStep = '', otherStep = '', incomeId = '';

  const mkLogin = async (key: string, role: string) => {
    const username = `mt-${key}-${Date.now()}`;
    const u = (await http().post('/api/admin/users').set(as(admin.access)).send({ username, password: 'role-pass-123', role }).expect(201)).body;
    const token = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access as string;
    return { id: String(u.id ?? u._id), token };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    const t = as(admin.access);
    for (const c of ['incomes', 'orderlineplans', 'workhours', 'worktypes', 'persons']) await db().collection(c).deleteMany({});
    const role = (await http().post('/api/roles').set(t).send({ label: 'Рабочий (тест)', baseRole: 'user', appSections: ['my-tasks'], money: false }).expect(201)).body;
    const me = await mkLogin('me', role.name);
    const other = await mkLogin('other', role.name);
    worker = me.token; stranger = other.token;
    const wt = (await db().collection('worktypes').insertOne({ name: 'Сварка', isActive: true, hourlyRate: 500, deletedAt: null })).insertedId;
    const mine = (await db().collection('persons').insertOne({ firstName: 'Иван', lastName: 'Мой', status: 'active', phone: '+7 900 000-00-01', salaryKind: 'hour', salaryRate: 400, workTypeIds: [wt], deletedAt: null })).insertedId;
    const theirs = (await db().collection('persons').insertOne({ firstName: 'Пётр', lastName: 'Чужой', status: 'active', phone: '+7 900 000-00-02', salaryKind: 'hour', salaryRate: 450, workTypeIds: [wt], deletedAt: null })).insertedId;
    // привязка входа: только админ/директор; повтор того же входа другому сотруднику — 409 «Этот вход уже привязан к …»
    await http().patch(`/api/dicts/persons/${mine}`).set(t).send({ userId: me.id }).expect(200);
    await http().patch(`/api/dicts/persons/${theirs}`).set(t).send({ userId: me.id }).expect(409);
    await http().patch(`/api/dicts/persons/${theirs}`).set(t).send({ userId: other.id }).expect(200);
    incomeId = String((await db().collection('incomes').insertOne({ title: 'Навес Н-1', orderNo: '2026-14', qty: 2, unitPrice: 9999, amount: 19998, shipDate: new Date('2026-12-01T00:00:00Z'), deletedAt: null })).insertedId);
    const s1 = new Types.ObjectId(), s2 = new Types.ObjectId();
    myStep = String(s1); otherStep = String(s2);
    planId = String((await db().collection('orderlineplans').insertOne({
      incomeId: new Types.ObjectId(incomeId), origin: 'manual', rev: 5, launchedAt: new Date(), deletedAt: null, parts: [],
      steps: [
        { _id: s1, workTypeId: wt, hours: 1.5, checked: true, assigneeId: mine },
        { _id: s2, workTypeId: wt, hours: 2, checked: true, assigneeId: theirs },
      ],
    })).insertedId);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('GET /my-tasks: только свои шаги, без денежных и лишних полей', async () => {
    const r = (await http().get('/api/my-tasks').set(as(worker)).expect(200)).body;
    expect(r.linked).toBe(true);
    expect(r.items.map((i: { stepId: string }) => i.stepId)).toEqual([myStep]);
    expect(r.items[0]).toMatchObject({ title: 'Навес Н-1', workTypeName: 'Сварка', orderNo: '2026-14', normHours: 3, state: 'waiting' });
    const keys = keysOf(r);
    for (const k of [...FORBIDDEN_KEYS, 'assigneeId', 'rev']) expect(keys.has(k)).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/9999|19998/);
  });

  it('чужой шаг и чужой план — 403, запись не проходит', async () => {
    await http().post(`/api/my-tasks/${planId}/${otherStep}/start`).set(as(worker)).send({}).expect(403);
    await http().post(`/api/my-tasks/${planId}/${myStep}/start`).set(as(stranger)).send({}).expect(403);
    await http().post(`/api/my-tasks/${new Types.ObjectId()}/${myStep}/start`).set(as(worker)).send({}).expect(403);
    const plan = await db().collection('orderlineplans').findOne({});
    expect(plan!.steps.find((s: { _id: Types.ObjectId }) => String(s._id) === otherStep).startedAt).toBeUndefined();
  });

  it('«Начал» и «Закончил»: отметки и факт-часы, повтор ничего не двоит, rev плана не растёт', async () => {
    const a = (await http().post(`/api/my-tasks/${planId}/${myStep}/start`).set(as(worker)).send({}).expect(200)).body;
    expect(a.state).toBe('working');
    const b = (await http().post(`/api/my-tasks/${planId}/${myStep}/start`).set(as(worker)).send({}).expect(200)).body;
    expect(b.startedAt).toBe(a.startedAt);
    const done = (await http().post(`/api/my-tasks/${planId}/${myStep}/finish`).set(as(worker)).send({}).expect(200)).body;
    expect(done.state).toBe('done');
    const again = (await http().post(`/api/my-tasks/${planId}/${myStep}/finish`).set(as(worker)).send({}).expect(200)).body;
    expect(again.finishedAt).toBe(done.finishedAt);
    const rows = await db().collection('workhours').find({ stepId: new Types.ObjectId(myStep) }).toArray();
    const keyDays = new Set(rows.map((x) => String(x.date)));
    expect(keyDays.size).toBe(rows.length); // по строке на день, без дублей
    expect((await db().collection('orderlineplans').findOne({}))!.rev).toBe(5);
  });

  it('«Отложить» и «Проблема»: причина обязательна; статус виден в списке; rev не растёт', async () => {
    await db().collection('orderlineplans').updateOne({ _id: new Types.ObjectId(planId) }, { $unset: { 'steps.0.startedAt': '', 'steps.0.finishedAt': '' } });
    await http().post(`/api/my-tasks/${planId}/${myStep}/defer`).set(as(worker)).send({}).expect(400);
    const d = (await http().post(`/api/my-tasks/${planId}/${myStep}/defer`).set(as(worker)).send({ reason: 'Нет материала' }).expect(200)).body;
    expect(d).toMatchObject({ state: 'deferred', reason: 'Нет материала' });
    expect(d.deferUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const p = (await http().post(`/api/my-tasks/${planId}/${myStep}/problem`).set(as(worker)).send({ reason: 'Поломка станка' }).expect(200)).body;
    expect(p).toMatchObject({ state: 'problem', reason: 'Поломка станка', deferUntil: null });
    expect((await http().get('/api/my-tasks').set(as(worker)).expect(200)).body.items[0].state).toBe('problem');
    expect((await db().collection('orderlineplans').findOne({}))!.rev).toBe(5);
  });

  it('менеджер сохраняет план — статус «Проблема» от рабочего не стирается', async () => {
    const plan = (await http().get(`/api/orderline-plans/by-income/${incomeId}`).set(as(admin.access)).expect(200)).body;
    const steps = plan.steps.map((s: Record<string, unknown>) => ({ id: s.id, workTypeId: s.workTypeId, partRowId: s.partRowId ?? undefined, hours: s.hours, checked: s.checked, assigneeId: s.assigneeId ?? undefined }));
    await http().put(`/api/orderline-plans/${plan.id}`).set(as(admin.access)).send({ rev: plan.rev, parts: [], steps }).expect(200);
    const stored = await db().collection('orderlineplans').findOne({});
    expect(stored!.steps.find((s: { _id: Types.ObjectId }) => String(s._id) === myStep)).toMatchObject({ status: 'problem', statusReason: 'Поломка станка' });
  });

  it('вход, не привязанный к сотруднику: список пуст, linked: false', async () => {
    const lone = await mkLogin('lone', 'user');
    const r = (await http().get('/api/my-tasks').set(as(lone.token)).expect(200)).body;
    expect(r).toEqual({ linked: false, items: [] });
  });

  it('«Рабочий» не привязывает входы и не видит чужие входы, телефоны и ставки в «Сотрудниках»', async () => {
    const list = (await http().get('/api/dicts/persons').set(as(worker)).expect(200)).body;
    const keys = keysOf(list);
    for (const k of ['salaryRate', 'salaryKind', 'phone', 'email', 'userId', 'userName']) expect(keys.has(k)).toBe(false);
    await http().patch(`/api/dicts/persons/${list.items[0].id}`).set(as(worker)).send({ userId: null }).expect(403);
  });

  it('закрытые разделы: заказы, заявки, склад, деньги — 403', async () => {
    for (const p of ['/api/salesorders', '/api/supply/requests', '/api/stock/items', '/api/incomes', '/api/orderline-plans/by-income/' + incomeId, '/api/work-schedule']) {
      await http().get(p).set(as(worker)).expect(403);
    }
  });

  it('обход: ни один открытый «Рабочему» GET без параметров не отдаёт деньги, ставки и телефоны', async () => {
    const paths: string[] = [];
    for (const w of app.get(DiscoveryService).getControllers()) {
      const type = w.metatype as (new (...a: never[]) => object) | null;
      if (!type) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, type) ?? '').replace(/^\/|\/$/g, '');
      for (const key of Object.getOwnPropertyNames(type.prototype)) {
        const handler = (type.prototype as Record<string, unknown>)[key];
        if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) !== RequestMethod.GET) continue;
        const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '').replace(/^\/|\/$/g, '');
        const path = [base, sub].filter(Boolean).join('/');
        if (!path.includes(':') && !path.includes('*')) paths.push(path);
      }
    }
    expect(paths.length).toBeGreaterThan(20);
    const leaks: string[] = [];
    let open = 0;
    for (const p of paths) {
      const res = await http().get('/api/' + p).set(as(worker));
      if (res.status !== 200 || !res.body || typeof res.body !== 'object') continue;
      open++;
      const found = FORBIDDEN_KEYS.filter((k) => keysOf(res.body).has(k));
      if (found.length) leaks.push(`${p}: ${found.join(',')}`);
    }
    expect(open).toBeGreaterThan(0);
    expect(leaks).toEqual([]);
  });
});
