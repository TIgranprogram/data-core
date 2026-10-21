import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** «Продукция» (TASKS БЗ-4): загрузка каталога по артикулу, витрина, группы, цена, КП, корзина. */
describe('Showcase', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    await ctx.connection.db!.collection('organizations').insertOne({ name: 'ООО «СпортИН-ЮГ»', shortName: 'СИЮ', inn: '2300000001', kpp: '230001001', isOurCompany: true, deletedAt: null });
  });
  afterAll(async () => { await ctx?.cleanup(); });

  const CAT = ['Перечень изделий 2026', 'Тип\tГруппа\tАртикул\tНаименование\tСерия', 'Детское оборудование\tКачели\t1001\tКачели «Гнездо»\tСказка', '\t\t1002\tКачели двойные\tСказка', 'Спорт\tВоркаут\t2001\tТурник\t'].join('\n');

  it('каталог: показ ничего не пишет, запись — по артикулу, повтор — без изменений, группы', async () => {
    const dry = (await http().post('/api/showcase/import').set(auth()).send({ text: CAT }).expect(200)).body;
    expect(dry).toMatchObject({ total: 3, new: 3, update: 0, applied: false });
    expect((await http().get('/api/showcase').set(auth()).expect(200)).body.total).toBe(0);
    expect((await http().post('/api/showcase/import').set(auth()).send({ text: CAT, apply: true }).expect(200)).body).toMatchObject({ new: 3, applied: true });
    expect((await http().post('/api/showcase/import').set(auth()).send({ text: CAT }).expect(200)).body).toMatchObject({ new: 0, update: 0, same: 3 });
    const list = (await http().get('/api/showcase').query({ search: 'качели' }).set(auth()).expect(200)).body;
    expect(list.items.map((x: { sku: string }) => x.sku).sort()).toEqual(['1001', '1002']);
    expect(list.items[0]).toMatchObject({ type: 'Детское оборудование', group: 'Качели', series: 'Сказка', status: 'draft', price: null });
    const groups = (await http().get('/api/showcase/groups').set(auth()).expect(200)).body as { id: string; name: string; parentId: string | null; count: number }[];
    const top = groups.find((g) => g.name === 'Детское оборудование')!;
    expect(top.count).toBe(2);
    expect((await http().get('/api/showcase').query({ groupId: top.id }).set(auth())).body.total).toBe(2);
  });

  it('правка цены — «в продаже»; КП: номер, реквизиты компании, суммы; корзина и восстановление', async () => {
    const [a] = (await http().get('/api/showcase').query({ search: '1001' }).set(auth())).body.items;
    const ed = (await http().patch(`/api/showcase/${a.id}`).set(auth()).send({ price: '125 000' }).expect(200)).body;
    expect(ed).toMatchObject({ price: 125000, status: 'active' });
    await http().post('/api/showcase').set(auth()).send({ sku: '1001', name: 'Дубль' }).expect(409);
    const kp1 = (await http().post('/api/showcase/kp').set(auth()).send({ items: [{ id: a.id, qty: 2 }], customer: 'ГБУ Жилищник' }).expect(200)).body;
    expect(kp1).toMatchObject({ customer: 'ГБУ Жилищник', total: 250000, noPrice: 0, company: { shortName: 'СИЮ', inn: '2300000001' } });
    expect(kp1.number).toMatch(/КП/);
    const kp2 = (await http().post('/api/showcase/kp').set(auth()).send({ items: [{ id: a.id, qty: 1, price: 100000 }] }).expect(200)).body;
    expect(kp2.number).not.toBe(kp1.number);
    expect(kp2.total).toBe(100000);
    await http().post('/api/showcase/kp').set(auth()).send({ items: [] }).expect(400);
    await http().delete(`/api/showcase/${a.id}`).set(auth()).expect(200);
    expect((await http().get('/api/showcase').query({ deleted: 1 }).set(auth())).body.items.map((x: { id: string }) => x.id)).toContain(a.id);
    await http().post(`/api/showcase/${a.id}/restore`).set(auth()).expect(200);
    expect((await http().get('/api/showcase').query({ search: '1001' }).set(auth())).body.total).toBe(1);
  });
});
