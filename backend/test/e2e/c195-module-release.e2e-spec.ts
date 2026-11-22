import request from 'supertest';
import { Types } from 'mongoose';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { createTestApp, type TestContext } from '../setup/test-db';

describe('C195 — выпуск модуля позиции заказа', () => {
  let ctx: TestContext;
  const db = () => ctx.connection.db!;
  const http = () => request(ctx.app.getHttpServer());
  let admin: ReturnType<typeof authHeader>;
  let reader: ReturnType<typeof authHeader>;

  beforeAll(async () => {
    ctx = await createTestApp({ strictValidation: true });
    admin = authHeader((await loginAsAdmin(ctx.app)).access);
    const role = (await http().post('/api/roles').set(admin)
      .send({ label: 'C195 просмотр проектирования', baseRole: 'user', appSections: ['design', 'work'] }).expect(201)).body.name;
    const credentials = { username: 'c195-reader', password: 'Fixture-c195-reader!' };
    await http().post('/api/admin/users').set(admin).send({ ...credentials, role }).expect(201);
    reader = authHeader((await http().post('/api/auth/login').send(credentials).expect(200)).body.access);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  async function fixture(label: string, seq: number) {
    const [cut, weld, moduleA, moduleB, lineA, lineB, product, design, partA, partB] = Array.from({ length: 10 }, () => new Types.ObjectId());
    const names = ['Резка ' + label, 'Сварка ' + label];
    await db().collection('worktypes').insertMany([
      { _id: cut, name: names[0], days: 1, isActive: true, deletedAt: null },
      { _id: weld, name: names[1], days: 1, isActive: true, deletedAt: null },
    ]);
    await db().collection('productmodules').insertMany([
      { _id: moduleA, name: 'Рама ' + label, article: 'R-' + label, deletedAt: null,
        workTypes: [{ workTypeId: weld, sortOrder: 1, estimatedHours: 4 }, { workTypeId: cut, sortOrder: 0, estimatedHours: 2 }] },
      { _id: moduleB, name: 'Полка ' + label, article: 'S-' + label, deletedAt: null,
        workTypes: [{ workTypeId: cut, sortOrder: 0, estimatedHours: 1 }] },
    ]);
    await db().collection('products').insertOne({ _id: product, name: 'Стеллаж ' + label, sku: label, deletedAt: null,
      composition: [{ _id: lineA, lineType: 'module', refId: moduleA, quantity: 2, sortOrder: 0 },
        { _id: lineB, lineType: 'module', refId: moduleB, quantity: 5, sortOrder: 1 }],
      parts: [{ _id: partA, name: 'Рама ' + label, qty: 2, lineId: lineA }, { _id: partB, name: 'Полка ' + label, qty: 5, lineId: lineB }],
      workTypes: [{ workTypeId: cut, partRowId: partA, hours: 2 }, { workTypeId: weld, partRowId: partA, hours: 4 },
        { workTypeId: cut, partRowId: partB, hours: 1 }],
    });
    const orderId = (await http().post('/api/salesorders').set(admin).send({ orderNo: label, productionNo: label, customer: 'Фикстура C195' }).expect(201)).body.id as string;
    const incomeId = (await http().post('/api/incomes').set(admin)
      .send({ orderId, productId: String(product), title: 'Стеллаж ' + label, qty: 3, unitPrice: 100, matchingMode: 'manual' }).expect(201)).body.id as string;
    await db().collection('designtasks').insertOne({ _id: design, seq, orderId: new Types.ObjectId(orderId), incomeId: new Types.ObjectId(incomeId),
      productId: product, status: 'done', deletedAt: null });
    const path = '/api/work-tasks/design/' + design + '/modules';
    return { names, orderId, incomeId, moduleA, lineA, lineB, product, design, path, label };
  }

  it('готовность вхождения, реальное задание, Гант, пауза, повтор и сборка', async () => {
    const f = await fixture('C195-A', 1951);
    const route = f.path + '/' + f.lineA;
    const second = { lineId: String(f.lineB), hasRoute: true, ready: false, task: null };
    const list = async () => (await http().get(f.path).set(admin).expect(200)).body;
    const readiness = async () => (await http().get('/api/production-orders/' + f.label + '/readiness').set(admin).expect(200)).body;
    const archiveReadiness = async () => (await http().get('/api/salesorders/' + f.orderId + '/archive/readiness').set(admin).expect(200)).body;
    const unfinishedWork = expect.objectContaining({ code: 'WORK_OPEN' });
    expect(await list()).toMatchObject({ productId: String(f.product), editable: true,
      items: [{ lineId: String(f.lineA), hasRoute: true, ready: false, task: null }, second] });
    await http().post(route + '/launch').set(admin).expect(409);
    const ready = (await http().patch(route).set(admin).send({ ready: true }).expect(200)).body;
    expect(ready.items).toEqual([{ lineId: String(f.lineA), hasRoute: true, ready: true, task: null }, second]);

    const task = (await http().post(route + '/launch').set(admin).expect(200)).body;
    expect(task).toMatchObject({
      code: expect.stringMatching(/^W-\d+$/), incomeId: f.incomeId, orderId: f.orderId, qty: 6, status: 'work', currentStep: f.names[0],
      moduleWork: { lineId: String(f.lineA), moduleId: String(f.moduleA), designTaskId: String(f.design), designCode: 'D-1951', name: 'Рама C195-A', quantity: 6 },
      route: f.names.map((name) => expect.objectContaining({ name })),
    });
    const taskPath = '/api/work-tasks/' + task.id;
    expect((await http().get(taskPath).set(admin).expect(200)).body).toMatchObject({ moduleWork: task.moduleWork, code: task.code });
    const board = (await http().get('/api/work-tasks').set(admin).query({ orderId: f.orderId }).expect(200)).body;
    expect(board.items).toMatchObject([{ id: task.id, moduleWork: task.moduleWork }]);
    expect((await http().post(route + '/launch').set(admin).expect(200)).body.id).toBe(task.id);
    await http().patch(route).set(admin).send({ ready: false }).expect(409);

    await http().get('/api/orderline-plans/by-income/' + f.incomeId).set(admin).expect(200);
    const schedule = async (query: object) => (await http().get('/api/work-schedule').set(admin).query(query).expect(200)).body.bars as Array<{ taskId?: string; partName: string }>;
    const gantt = async (query: object) => (await schedule(query)).filter((bar) => bar.taskId === task.id);
    const expectedBars = f.names.map((workTypeName, stepIndex) => expect.objectContaining({
      taskId: task.id, stepIndex, workTypeName, incomeId: f.incomeId, orderId: f.orderId,
      partName: 'Рама C195-A', partRowId: String(f.lineA), partId: String(f.moduleA),
    }));
    expect(await gantt({ incomeId: f.incomeId })).toEqual(expectedBars);
    expect(await gantt({ orderId: f.orderId })).toEqual(expectedBars);
    expect((await schedule({ incomeId: f.incomeId })).filter((bar) => bar.partName === 'Рама C195-A')).toHaveLength(2);

    const full = async () => (await http().post('/api/work-tasks/launch').set(admin).send({ lineIds: [f.incomeId] }).expect(200)).body;
    expect(await full()).toMatchObject({ created: 0, refused: [{ incomeId: f.incomeId, reason: 'Модули позиции ещё в работе' }] });
    expect((await readiness()).checks).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'made', ok: false, hint: expect.stringContaining('Ещё в работе') })]));
    expect((await archiveReadiness()).blockers).toContainEqual(unfinishedWork);

    const hold = { kind: 'materials', reason: 'Нет фанеры' };
    await http().patch(taskPath + '/hold').set(admin).send({ kind: 'materials' }).expect(400);
    expect((await http().patch(taskPath + '/hold').set(admin).send(hold).expect(200)).body.hold).toMatchObject(hold);
    expect(await gantt({ incomeId: f.incomeId })).toEqual(f.names.map((workTypeName) => expect.objectContaining({ workTypeName, hold })));
    await http().post(taskPath + '/move').set(admin).send({ to: 'next' }).expect(409);
    await http().post(taskPath + '/done').set(admin).expect(409);
    expect((await http().patch(taskPath + '/hold').set(admin).send({ kind: 'resume' }).expect(200)).body.hold).toBeNull();
    expect((await http().post(taskPath + '/move').set(admin).send({ to: 'next' }).expect(200)).body.currentStep).toBe(f.names[1]);
    expect((await http().post(taskPath + '/done').set(admin).expect(200)).body.status).toBe('done');
    expect((await http().post(route + '/launch').set(admin).expect(200)).body.id).toBe(task.id);
    expect((await list()).items).toMatchObject([{ lineId: String(f.lineA), task: { id: task.id, status: 'done' } }, second]);
    expect((await readiness()).checks).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'made', ok: false, hint: expect.stringContaining('сборку') })]));

    expect((await archiveReadiness()).blockers).toContainEqual(unfinishedWork);
    const whole = await full();
    expect(whole).toMatchObject({ created: 1, items: [{ moduleWork: null }] });
    expect(whole.items[0].route.map((step: { name: string }) => step.name)).not.toContain(f.names[1]);
    expect((await list()).items[1]).toEqual(second);
    await http().post('/api/work-tasks/' + whole.items[0].id + '/done').set(admin).expect(200);
    expect((await readiness()).checks).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'made', ok: true })]));
    expect((await archiveReadiness()).blockers).toContainEqual(unfinishedWork);
    const plan = (await http().get('/api/orderline-plans/by-income/' + f.incomeId).set(admin).expect(200)).body;
    const wholeSteps = new Set(whole.items[0].route.map((step: { stepId: string }) => step.stepId));
    const planSteps = plan.steps as Array<{ id: string; partName: string; finishedAt: string | null }>;
    const remainingSteps = planSteps.filter((step) => wholeSteps.has(step.id));
    const releasedSteps = planSteps.filter((step) => step.partName === 'Рама C195-A');
    expect(remainingSteps).toHaveLength(1);
    expect(releasedSteps).toHaveLength(2);
    expect(releasedSteps.every((step) => !step.finishedAt && !wholeSteps.has(step.id))).toBe(true);
    for (const step of remainingSteps) {
      const mark = '/api/orderline-plans/' + plan.id + '/steps/' + step.id + '/mark';
      await http().post(mark).set(admin).send({ what: 'start' }).expect(200);
      await http().post(mark).set(admin).send({ what: 'finish' }).expect(200);
    }
    expect((await archiveReadiness()).blockers).not.toContainEqual(unfinishedWork);
    expect((await db().collection('products').findOne({ _id: f.product }))?.composition[1]).toMatchObject({ _id: f.lineB, quantity: 5, sortOrder: 1 });
  });

  it('наблюдатель, устаревшая отметка и архив договора', async () => {
    const f = await fixture('C195-B', 1952);
    const route = f.path + '/' + f.lineB;
    await http().get(f.path).set(reader).expect(200);
    await http().patch(route).set(reader).send({ ready: true }).expect(403);
    await http().post(route + '/launch').set(reader).expect(403);
    await http().patch(f.path + '/' + new Types.ObjectId()).set(admin).send({ ready: true }).expect(404);
    await http().patch(route).set(admin).send({ ready: true }).expect(200);
    await db().collection('products').updateOne({ _id: f.product, 'composition._id': f.lineB }, { $set: { 'composition.$.quantity': 4 } });
    const list = async () => (await http().get(f.path).set(admin).expect(200)).body;
    expect((await list()).items[1]).toMatchObject({ lineId: String(f.lineB), ready: false, task: null });
    await http().post(route + '/launch').set(admin).expect(409);
    await http().patch(route).set(admin).send({ ready: true }).expect(200);
    await db().collection('salesorders').updateOne({ _id: new Types.ObjectId(f.orderId) }, { $set: { activeArchiveVersion: 1 } });
    expect(await list()).toMatchObject({ editable: false });
    await http().patch(route).set(admin).send({ ready: false }).expect(409);
    await http().post(route + '/launch').set(admin).expect(409);
    expect(await db().collection('worktasks').countDocuments({ incomeId: new Types.ObjectId(f.incomeId) })).toBe(0);
  });
});
