import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { User, type UserDocument } from '../../src/modules/user/user.schema';
import { ControlService } from '../../src/modules/control/control.service';

/** CC-14…16: «Разбор» — права, путь слияния контрагентов целиком, двойное нажатие, откат, лимиты. Только тестовая БД. */
describe('Разбор: вопросы и действия (CC-14…16)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  let manager = '';
  let service = '';
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);
  const db = () => ctx!.connection;
  const Q = '/api/control/questions';

  const login = async (username: string, role: string, permissions: string[] = []) => {
    const users = app.get<Model<UserDocument>>(getModelToken(User.name));
    await users.create({ username, email: `${username}@kppdf.local`, displayName: username, passwordHash: await bcrypt.hash('cc-pass-123', 10), role, permissions, isActive: true });
    return (await http().post('/api/auth/login').send({ username, password: 'cc-pass-123' }).expect(200)).body.access as string;
  };

  /** Два контрагента-поставщика и две заявки у первого. */
  const seedPair = async (tag: string) => {
    const a = new Types.ObjectId(), b = new Types.ObjectId();
    await db().collection('organizations').insertMany([
      { _id: a, name: `Ромашка ${tag}`, inn: `77${String(Date.now()).slice(-8)}`, type: ['supplier'], deletedAt: null },
      { _id: b, name: `Ромашка Плюс ${tag}`, inn: `78${String(Date.now()).slice(-8)}`, type: ['supplier'], deletedAt: null },
    ]);
    await db().collection('supplyrequests').insertMany([
      { _id: new Types.ObjectId(), supplierId: a, title: `Болт ${tag}`, status: 'requested', deletedAt: null },
      { _id: new Types.ObjectId(), supplierId: a, title: `Гайка ${tag}`, status: 'requested', deletedAt: null },
    ]);
    return { a, b };
  };
  const ask = async (a: Types.ObjectId, b: Types.ObjectId) =>
    (await http().post(Q).set(as(admin.access)).send({ type: 'merge_partners', sourceName: 'e2e', params: { fromId: String(a), intoId: String(b) } }).expect(201)).body as { id: string; created: boolean; overflow: boolean };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    manager = await login(`cq-mgr-${Date.now()}`, 'manager');
    service = await login(`cq-svc-${Date.now()}`, 'user', ['control:write']);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('права: без входа 401; менеджер и наблюдатель читать и отвечать не могут; ставить вопрос — только с правом control:write', async () => {
    for (const [m, p] of [['get', Q], ['get', `${Q}/x`], ['post', `${Q}/x/preview`], ['post', `${Q}/x/answer`], ['post', `${Q}/x/undo`], ['get', `${Q}/x/events`]] as const) {
      await http()[m](p).expect(401);
      await http()[m](p).set(as(manager)).send(m === 'post' ? {} : undefined).expect(403);
      await http()[m](p).set(as(service)).send(m === 'post' ? {} : undefined).expect(403);
    }
    await http().post(Q).set(as(manager)).send({ type: 'free_text', what: 'Можно?' }).expect(403);
    await http().post(Q).set(as(service)).send({ type: 'free_text', what: 'Можно ли списывать болты?', sourceName: 'ИИ-помощник' }).expect(201);
    await http().post(Q).set(as(service)).send({ type: 'overflow', what: 'x' }).expect(400); // служебные типы присылать нельзя
  });

  it('путь слияния: вопрос → предпросмотр → неверный хеш 409 → подтверждение → запись → журнал', async () => {
    const { a, b } = await seedPair('путь');
    const created = await ask(a, b);
    expect(created).toMatchObject({ created: true, overflow: false });
    const q = (await http().get(`${Q}/${created.id}`).set(as(admin.access)).expect(200)).body;
    expect(q).toMatchObject({ status: 'open', type: 'merge_partners', id: created.id });
    expect(q.what).toContain('Ромашка путь');
    expect(JSON.stringify(q.options)).toContain('partners.merge');

    const pv = (await http().post(`${Q}/${created.id}/preview`).set(as(admin.access)).send({ optionCode: 'merge' }).expect(200)).body;
    expect(pv.lines.join(' ')).toMatch(/2 заявки на снабжение/);
    expect(pv).toMatchObject({ reversible: true });

    // без хеша и с чужим хешем запись не идёт
    await http().post(`${Q}/${created.id}/answer`).set(as(admin.access)).send({ optionCode: 'merge' }).expect(400);
    const bad = await http().post(`${Q}/${created.id}/answer`).set(as(admin.access)).send({ optionCode: 'merge', planHash: '0000000000000000' }).expect(409);
    expect(bad.body.preview.planHash).toBe(pv.planHash);
    expect(await db().collection('supplyrequests').countDocuments({ supplierId: a })).toBe(2);

    const done = (await http().post(`${Q}/${created.id}/answer`).set(as(admin.access)).send({ optionCode: 'merge', planHash: pv.planHash }).expect(200)).body;
    expect(done).toMatchObject({ status: 'done', canUndo: true });
    expect(await db().collection('supplyrequests').countDocuments({ supplierId: b })).toBe(2);
    const gone = await db().collection('organizations').findOne({ _id: a });
    expect(gone!.deletedAt).toBeTruthy();
    expect(String(gone!.mergedInto)).toBe(String(b));

    const ev = (await http().get(`${Q}/${created.id}/events`).set(as(admin.access)).expect(200)).body;
    expect(ev.items.map((e: { kind: string }) => e.kind)).toEqual(['created', 'executing', 'done']);
    expect(ev).toMatchObject({ page: 1 });
    await http().post(`${Q}/${created.id}/answer`).set(as(admin.access)).send({ optionCode: 'dismiss' }).expect(409); // закрытый вопрос
  });

  it('откат возвращает как было; после чужой правки — отказ и правка не теряется', async () => {
    const { a, b } = await seedPair('откат');
    const { id } = await ask(a, b);
    const pv = (await http().post(`${Q}/${id}/preview`).set(as(admin.access)).send({}).expect(200)).body;
    await http().post(`${Q}/${id}/answer`).set(as(admin.access)).send({ optionCode: 'merge', planHash: pv.planHash }).expect(200);
    const undone = (await http().post(`${Q}/${id}/undo`).set(as(admin.access)).expect(200)).body;
    expect(undone.status).toBe('open');
    expect(await db().collection('supplyrequests').countDocuments({ supplierId: a })).toBe(2);
    expect((await db().collection('organizations').findOne({ _id: a }))!.deletedAt).toBeNull();
    await http().post(`${Q}/${id}/undo`).set(as(admin.access)).expect(409);

    // второе слияние и правка заявки менеджером после него
    const pv2 = (await http().post(`${Q}/${id}/preview`).set(as(admin.access)).send({}).expect(200)).body;
    await http().post(`${Q}/${id}/answer`).set(as(admin.access)).send({ optionCode: 'merge', planHash: pv2.planHash }).expect(200);
    await db().collection('supplyrequests').updateOne({ supplierId: b, title: /^Болт/ }, { $set: { title: 'Болт (правка менеджера)' } });
    const refuse = await http().post(`${Q}/${id}/undo`).set(as(admin.access)).expect(409);
    expect(JSON.stringify(refuse.body)).toContain('уже менялись');
    expect(await db().collection('supplyrequests').countDocuments({ title: 'Болт (правка менеджера)' })).toBe(1);
  });

  it('двойное нажатие: слияние выполняется один раз', async () => {
    const { a, b } = await seedPair('дубль');
    const { id } = await ask(a, b);
    const pv = (await http().post(`${Q}/${id}/preview`).set(as(admin.access)).send({}).expect(200)).body;
    const send = () => http().post(`${Q}/${id}/answer`).set(as(admin.access)).send({ optionCode: 'merge', planHash: pv.planHash });
    const res = await Promise.all([send(), send(), send()]);
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(2);
    const events = await db().collection('app_control_events').countDocuments({ questionId: new Types.ObjectId(id), kind: 'done' });
    expect(events).toBe(1);
  });

  it('сбой действия: статус «не вышло» с понятным текстом, данные не тронуты, повтор руками', async () => {
    const { a, b } = await seedPair('сбой');
    // у обоих поставщиков договор с одним номером — слияние откажет
    await db().collection('suppliercontracts').insertMany([
      { _id: new Types.ObjectId(), supplierId: a, no: 'Д-1', deletedAt: null },
      { _id: new Types.ObjectId(), supplierId: b, no: 'Д-1', deletedAt: null },
    ]);
    const { id } = await ask(a, b);
    const pv = (await http().post(`${Q}/${id}/preview`).set(as(admin.access)).send({}).expect(200)).body;
    const q = (await http().post(`${Q}/${id}/answer`).set(as(admin.access)).send({ optionCode: 'merge', planHash: pv.planHash }).expect(200)).body;
    expect(q.status).toBe('failed');
    expect(q.exec.error).toContain('номера договоров');
    expect(await db().collection('supplyrequests').countDocuments({ supplierId: a })).toBe(2);
    expect(await db().collection('app_control_undo').countDocuments({ questionId: new Types.ObjectId(id) })).toBe(0);
    await db().collection('suppliercontracts').deleteMany({ no: 'Д-1' });
    const pv2 = (await http().post(`${Q}/${id}/preview`).set(as(admin.access)).send({}).expect(200)).body;
    expect((await http().post(`${Q}/${id}/answer`).set(as(admin.access)).send({ optionCode: 'merge', planHash: pv2.planHash }).expect(200)).body.status).toBe('done');
  });

  it('«Не проблема», «Отложить» (не больше 2 раз), возврат из корзины, список с фильтрами', async () => {
    const x = new Types.ObjectId();
    await db().collection('organizations').insertOne({ _id: x, name: 'Из корзины', inn: '7700000001', type: ['supplier'], deletedAt: new Date() });
    const r = (await http().post(Q).set(as(admin.access)).send({ type: 'restore_trash', params: { target: 'partner', id: String(x) } }).expect(201)).body;
    const pv = (await http().post(`${Q}/${r.id}/preview`).set(as(admin.access)).send({}).expect(200)).body;
    expect((await http().post(`${Q}/${r.id}/answer`).set(as(admin.access)).send({ optionCode: 'restore', planHash: pv.planHash }).expect(200)).body.status).toBe('done');
    expect((await db().collection('organizations').findOne({ _id: x }))!.deletedAt).toBeNull();

    const t = (await http().post(Q).set(as(admin.access)).send({ type: 'free_text', what: 'Отложим?', sourceName: 'e2e-2' }).expect(201)).body;
    const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    await http().post(`${Q}/${t.id}/answer`).set(as(admin.access)).send({ optionCode: 'snooze' }).expect(400);
    await http().post(`${Q}/${t.id}/answer`).set(as(admin.access)).send({ optionCode: 'snooze', snoozeUntil: future(2) }).expect(200);
    // отложенный вопрос можно снова отложить (вторая из двух), третий раз — нельзя
    await http().post(`${Q}/${t.id}/answer`).set(as(admin.access)).send({ optionCode: 'snooze', snoozeUntil: future(3) }).expect(200);
    await http().post(`${Q}/${t.id}/answer`).set(as(admin.access)).send({ optionCode: 'snooze', snoozeUntil: future(4) }).expect(409);
    const dis = (await http().post(`${Q}/${t.id}/answer`).set(as(admin.access)).send({ optionCode: 'dismiss', comment: 'не нужно' }).expect(200)).body;
    expect(dis).toMatchObject({ status: 'dismissed', active: false });

    const list = (await http().get(`${Q}?status=dismissed&type=free_text`).set(as(admin.access)).expect(200)).body;
    expect(list).toMatchObject({ total: 1, page: 1, limit: 50 });
    expect(list.counts.dismissed).toBe(1);
    await http().get(`${Q}?status=нет`).set(as(admin.access)).expect(400);
  });

  it('лимит: после 20 новых от одного источника — один сводный вопрос', async () => {
    for (let i = 0; i < 20; i++) await http().post(Q).set(as(service)).send({ type: 'free_text', what: `Лимит ${i}`, sourceName: 'болтун' }).expect(201);
    const o1 = (await http().post(Q).set(as(service)).send({ type: 'free_text', what: 'Лимит лишний', sourceName: 'болтун' }).expect(201)).body;
    const o2 = (await http().post(Q).set(as(service)).send({ type: 'free_text', what: 'Лимит лишний 2', sourceName: 'болтун' }).expect(201)).body;
    expect(o1.overflow && o2.overflow).toBe(true);
    expect(o1.id).toBe(o2.id);
    expect(await db().collection('app_control_questions').countDocuments({ type: 'overflow', 'subject.ids': 'болтун' })).toBe(1);
  });

  it('индексы и показатели: уникальный ключ активного вопроса, TTL откатов, числа в снимке дня', async () => {
    const idx = await db().collection('app_control_questions').indexes();
    expect(idx.find((i) => i.key.key === 1)).toMatchObject({ unique: true, partialFilterExpression: { active: true } });
    expect(idx.some((i) => i.key.status === 1 && i.key.severity === 1)).toBe(true);
    expect(idx.some((i) => i.key.dueAt === 1)).toBe(true);
    const u = await db().collection('app_control_undo').indexes();
    expect(u.find((i) => i.key.keepUntil === 1)).toMatchObject({ expireAfterSeconds: 0 });
    await app.get(ControlService).snapshotDay(new Date(), { force: true });
    const m = (await http().get('/api/control/daily').set(as(admin.access)).expect(200)).body.items[0].m;
    expect(typeof m['control.questions_open']).toBe('number');
    expect(m['control.questions_open']).toBeGreaterThan(0);
    expect(typeof m['control.failed_actions']).toBe('number');
    expect(typeof m['control.overdue']).toBe('number');
    expect(m['control.age_median_d']).not.toBeUndefined();
  });
});
