import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * «В работе»: маршрут изделия (PUT /work-routes), запуск позиций, перевод по шагам, исполнитель,
 * несколько видов работ у сотрудника. НЕ запускался (нет Docker при написании).
 */
describe('Work tasks (В работе)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  let orderId = '', lineA = '', lineB = '', lineC = '', productA = '', productB = '', cut = '', weld = '', personId = '';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['salesorders', 'incomes', 'worktasks', 'persons', 'products', 'worktypes']) await db().collection(c).deleteMany({});
    cut = String((await db().collection('worktypes').insertOne({ name: 'Резка', isActive: true, hourlyRate: 0, deletedAt: null })).insertedId);
    weld = String((await db().collection('worktypes').insertOne({ name: 'Сварка', isActive: true, hourlyRate: 0, deletedAt: null })).insertedId);
    productA = String((await db().collection('products').insertOne({ name: 'Скамья', sku: '3410', photoIds: [], deletedAt: null })).insertedId);
    productB = String((await db().collection('products').insertOne({ name: 'Урна', sku: '1200', photoIds: [], deletedAt: null })).insertedId);
    orderId = (await http().post('/api/salesorders').set(auth()).send({ orderNo: '30-26', productionNo: '30-26', customer: 'ООО Парк' }).expect(201)).body.id;
    lineA = (await http().post('/api/incomes').set(auth()).send({ orderId, title: 'Скамья', qty: 2, unitPrice: 1000, productId: productA }).expect(201)).body.id;
    lineB = (await http().post('/api/incomes').set(auth()).send({ orderId, title: 'Урна', qty: 1, productId: productB }).expect(201)).body.id;
    lineC = (await http().post('/api/incomes').set(auth()).send({ orderId, title: 'Беседка', qty: 1 }).expect(201)).body.id;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('маршрут изделия: пустой → записать → повтор вида работ 400 → прочитать', async () => {
    expect((await http().get(`/api/work-routes/${productA}`).set(auth()).expect(200)).body).toMatchObject({ hasRoute: false, steps: [] });
    await http().put(`/api/work-routes/${productA}`).set(auth()).send({ steps: [{ workTypeId: weld }, { workTypeId: weld }] }).expect(400);
    const r = (await http().put(`/api/work-routes/${productA}`).set(auth()).send({ steps: [{ workTypeId: cut }, { workTypeId: weld, note: 'MIG' }] }).expect(200)).body;
    expect(r.steps.map((s: { name: string }) => s.name)).toEqual(['Резка', 'Сварка']);
    // удалить вид работ из справочника, пока он в маршруте, нельзя
    await http().delete(`/api/work-types/${cut}`).set(auth()).expect(409);
  });

  let taskId = '';
  it('запуск заказа: изделие с маршрутом и без; позиция без изделия — в refused; повтор — «Уже в работе»', async () => {
    const r = (await http().post('/api/work-tasks/launch').set(auth()).send({ orderId }).expect(200)).body;
    expect(r).toMatchObject({ created: 2, skipped: 1 });
    expect(r.refused[0]).toMatchObject({ incomeId: lineC, reason: expect.stringContaining('Нет изделия') });
    expect(r.warnings).toHaveLength(1);
    const a = r.items.find((i: { productId: string }) => i.productId === productA);
    taskId = a.id;
    expect(a).toMatchObject({ status: 'work', currentStep: 'Резка', code: expect.stringMatching(/^W-\d+$/) });
    const again = (await http().post('/api/work-tasks/launch').set(auth()).send({ lineIds: [lineA] }).expect(200)).body;
    expect(again.refused[0].reason).toMatch(/Уже в работе/);
    expect(lineB).toBeTruthy();
  });

  it('доска: колонки и счётчики; перевод на следующий шаг и «Готово»', async () => {
    const board = (await http().get('/api/work-tasks').set(auth()).expect(200)).body;
    expect(board.columns.map((c: { title: string }) => c.title)).toEqual(['Ждёт запуска', 'Резка', 'Сварка', 'Изготовление', 'Готово']);
    expect(board.counts).toMatchObject({ work: 2, all: 2 });
    expect((await http().post(`/api/work-tasks/${taskId}/move`).set(auth()).send({ to: 'next' }).expect(200)).body).toMatchObject({ currentStep: 'Сварка', stepIndex: 1 });
    await http().post(`/api/work-tasks/${taskId}/move`).set(auth()).send({}).expect(400);
    expect((await http().post(`/api/work-tasks/${taskId}/move`).set(auth()).send({ to: 'next' }).expect(200)).body).toMatchObject({ status: 'done' });
    expect((await http().get('/api/work-tasks').query({ status: 'done' }).set(auth()).expect(200)).body.total).toBe(1);
    // после «Готово» позицию можно запустить заново
    expect((await http().post('/api/work-tasks/launch').set(auth()).send({ lineIds: [lineA] }).expect(200)).body.created).toBe(1);
  });

  it('сотрудник: несколько видов работ через справочник; исполнитель — только работающий', async () => {
    personId = (await http().post('/api/dicts/persons').set(auth()).send({ firstName: 'Пётр', lastName: 'Иванов', workTypeIds: [cut, weld] }).expect(201)).body.id;
    const p = await db().collection('persons').findOne({ firstName: 'Пётр' });
    expect(p!.workTypeIds.map(String)).toEqual([cut, weld]);
    expect(String(p!.workTypeId)).toBe(cut);
    expect((await http().get('/api/work-tasks/people').query({ workTypeId: weld }).set(auth()).expect(200)).body.items).toHaveLength(1);
    const t = (await http().get('/api/work-tasks').query({ status: 'work' }).set(auth()).expect(200)).body.items[0];
    expect((await http().patch(`/api/work-tasks/${t.id}`).set(auth()).send({ assigneeId: personId }).expect(200)).body.assignee.name).toBe('Иванов Пётр');
    await http().post(`/api/work-tasks/${t.id}/cancel`).set(auth()).send({ reason: 'Расторгли договор' }).expect(200);
  });
});
