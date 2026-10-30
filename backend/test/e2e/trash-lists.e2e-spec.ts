import request from 'supertest';
import { Types } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** Экран «Корзина» (pwa/sections/trash.js): каждый его список принимает deleted=1 и сортировку по дате удаления. */
describe('Корзина: списки удалённого', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it.each(['/supply/requests', '/stock/items', '/salesorders', '/incomes', '/partners', '/showcase', '/passports', '/offers', '/design-tasks', '/work-tasks'])('%s', async (path) => {
    const r = await request(app.getHttpServer()).get(`/api${path}`).query({ deleted: 1, sort: '-deletedAt', limit: 100 }).set(authHeader(token.access)).expect(200);
    expect(Array.isArray(r.body.items)).toBe(true);
  });
});

/** Корзина целиком: создать → удалить → найти в корзине (и нет в обычном списке) → восстановить. */
describe('Корзина: удалить и вернуть', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  const ids = (b: { items: Array<{ id: string }> }) => b.items.map((x) => x.id);
  const trash = async (path: string, q: Record<string, unknown> = {}) => ids((await http().get(`/api${path}`).query({ deleted: 1, sort: '-deletedAt', limit: 100, ...q }).set(auth()).expect(200)).body);
  const live = async (path: string, q: Record<string, unknown> = {}) => ids((await http().get(`/api${path}`).query({ limit: 100, ...q }).set(auth()).expect(200)).body);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['salesorders', 'incomes', 'products', 'worktasks', 'worktypes', 'designtasks', 'designorders']) await db().collection(c).deleteMany({});
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('изделие (showcase): удалено → в корзине, нет в списке → восстановлено', async () => {
    const p = (await http().post('/api/showcase').set(auth()).send({ sku: 'TR-1', name: 'Корзина-изделие', type: 'Спорт' }).expect(201)).body;
    expect(await live('/showcase', { search: 'Корзина-изделие' })).toContain(p.id);
    await http().delete(`/api/showcase/${p.id}`).set(auth()).expect(200);
    expect(await live('/showcase', { search: 'Корзина-изделие' })).not.toContain(p.id);
    expect(await trash('/showcase')).toContain(p.id);
    await http().post(`/api/showcase/${p.id}/restore`).set(auth()).expect(200);
    expect(await trash('/showcase')).not.toContain(p.id);
    expect(await live('/showcase', { search: 'Корзина-изделие' })).toContain(p.id);
  });

  it('задание «В работе»: удалено → в корзине → восстановлено, статус сохранён', async () => {
    const product = String((await db().collection('products').insertOne({ name: 'Скамья корзина', sku: '9001', photoIds: [], deletedAt: null })).insertedId);
    const order = (await http().post('/api/salesorders').set(auth()).send({ orderNo: 'К-1', customer: 'ООО Корзина' }).expect(201)).body.id;
    const line = (await http().post('/api/incomes').set(auth()).send({ orderId: order, title: 'Скамья', qty: 1, productId: product }).expect(201)).body.id;
    const t = (await http().post('/api/work-tasks/launch').set(auth()).send({ lineIds: [line] }).expect(200)).body.items[0];
    expect(t.status).toBe('work');
    await http().delete(`/api/work-tasks/${t.id}`).set(auth()).expect(200);
    expect(await live('/work-tasks')).not.toContain(t.id);
    expect(await trash('/work-tasks')).toContain(t.id);
    await http().post(`/api/work-tasks/${t.id}/restore`).set(auth()).expect(200);
    expect(await trash('/work-tasks')).not.toContain(t.id);
    expect(await live('/work-tasks')).toContain(t.id);
    expect((await http().get('/api/work-tasks').query({ status: 'work' }).set(auth()).expect(200)).body.items.find((x: { id: string }) => x.id === t.id)).toBeTruthy();
  });

  it('задача проектирования: удалена → в корзине → восстановлена', async () => {
    const d = (await http().post('/api/design-tasks').set(auth()).send({ title: 'Эскиз корзина' }).expect(201)).body;
    await http().delete(`/api/design-tasks/${d.id}`).set(auth()).expect(200);
    expect(await live('/design-tasks')).not.toContain(d.id);
    expect(await trash('/design-tasks')).toContain(d.id);
    await http().post(`/api/design-tasks/${d.id}/restore`).set(auth()).expect(200);
    expect(await live('/design-tasks')).toContain(d.id);
  });

  it('позиция заказа: удалена → в корзине позиций, нет в заказе → восстановлена', async () => {
    const order = (await http().post('/api/salesorders').set(auth()).send({ orderNo: 'К-2', customer: 'ООО Корзина' }).expect(201)).body.id;
    const a = (await http().post('/api/incomes').set(auth()).send({ orderId: order, title: 'Позиция А', qty: 1 }).expect(201)).body.id;
    const b = (await http().post('/api/incomes').set(auth()).send({ orderId: order, title: 'Позиция Б', qty: 1 }).expect(201)).body.id;
    await http().delete(`/api/incomes/${a}`).set(auth()).expect(200);
    expect(await live('/incomes', { orderId: order })).toEqual([b]);
    expect(await trash('/incomes', { orderId: order })).toEqual([a]);
    expect((await http().get(`/api/salesorders/${order}`).set(auth()).expect(200)).body.lineCount).toBe(1);
    await http().post(`/api/incomes/${a}/restore`).set(auth()).expect(200);
    expect((await live('/incomes', { orderId: order })).sort()).toEqual([a, b].sort());
    expect(await trash('/incomes', { orderId: order })).toEqual([]);
  });

  it('заказ с позициями: уходит вместе с ними, возвращается только то, что ушло вместе с ним', async () => {
    const order = (await http().post('/api/salesorders').set(auth()).send({ orderNo: 'К-3', customer: 'ООО Корзина' }).expect(201)).body.id;
    const mk = async (title: string) => (await http().post('/api/incomes').set(auth()).send({ orderId: order, title, qty: 1 }).expect(201)).body.id as string;
    const [a, b, early] = [await mk('Вместе А'), await mk('Вместе Б'), await mk('Удалена раньше')];
    await http().delete(`/api/incomes/${early}`).set(auth()).expect(200);

    await http().delete(`/api/salesorders/${order}`).set(auth()).expect(200);
    await http().get(`/api/salesorders/${order}`).set(auth()).expect(404);
    expect(await live('/salesorders')).not.toContain(order);
    expect(await trash('/salesorders')).toContain(order);
    expect(await live('/incomes', { orderId: order })).toEqual([]);
    // в корзине позиций все три: две ушли с заказом, одна раньше
    expect((await trash('/incomes', { orderId: order })).sort()).toEqual([a, b, early].sort());
    // у позиций, ушедших с заказом, есть метка; у удалённой раньше — нет
    const raw = (id: string) => db().collection('incomes').findOne({ _id: new Types.ObjectId(id) });
    expect(await raw(a)).toMatchObject({ deletedWithOrder: true });
    expect((await raw(early))!.deletedWithOrder).toBeFalsy();

    const back = (await http().post(`/api/salesorders/${order}/restore`).set(auth()).expect(200)).body;
    expect(back.lineCount).toBe(2);
    expect((await live('/incomes', { orderId: order })).sort()).toEqual([a, b].sort());
    expect(await trash('/incomes', { orderId: order })).toEqual([early]);
    expect(await trash('/salesorders')).not.toContain(order);
    expect(await live('/salesorders')).toContain(order);
    // метка снята, чтобы повторное удаление и возврат вели себя так же
    expect((await raw(a))!.deletedWithOrder).toBeUndefined();
    await http().delete(`/api/salesorders/${order}`).set(auth()).expect(200);
    await http().post(`/api/salesorders/${order}/restore`).set(auth()).expect(200);
    expect(await trash('/incomes', { orderId: order })).toEqual([early]);
  });
});
