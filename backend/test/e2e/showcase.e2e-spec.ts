import request from 'supertest';
import { Types } from 'mongoose';
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
    // ФИ2: в форме раздел обязателен; характеристики, тексты для паспорта, статус; черновик с ценой — «в продаже»
    await http().post('/api/showcase').set(auth()).send({ sku: 'F-1', name: 'Без раздела' }).expect(400);
    const f = (await http().post('/api/showcase').set(auth()).send({ sku: 'F-1', name: 'Турник', type: 'Спорт', status: 'draft', price: 1000, unit: '', weightKg: '12,5', ralCode: 'RAL 6005',
      dimensions: { length: '2000', width: '', height: 2500, unit: 'мм' }, purpose: 'Для подтягиваний' }).expect(201)).body;
    expect(f).toMatchObject({ type: 'Спорт', status: 'active', unit: 'шт', weightKg: 12.5, ralCode: 'RAL 6005', dimensions: { length: 2000, width: null, height: 2500, unit: 'мм' }, purpose: 'Для подтягиваний', passportCategory: null });
    expect((await http().patch(`/api/showcase/${f.id}`).set(auth()).send({ status: 'archived', dimensions: {} }).expect(200)).body).toMatchObject({ status: 'archived', dimensions: null });
    await http().patch(`/api/showcase/${f.id}`).set(auth()).send({ status: 'sold' }).expect(400);
    await http().delete(`/api/showcase/${f.id}`).set(auth()).expect(200);
    // дубли артикула: регистр, похожие буквы (KC-01 латиницей = КС-01 кириллицей), пробелы; в т. ч. изделие в корзине
    await http().post('/api/showcase').set(auth()).send({ sku: ' f-1 ', name: 'Дубль из корзины', type: 'Спорт' }).expect(409);
    await http().post('/api/showcase').set(auth()).send({ sku: 'KC-01', name: 'Скамья', type: 'МАФ' }).expect(201);
    await http().post('/api/showcase').set(auth()).send({ sku: 'кс-01', name: 'Скамья 2', type: 'МАФ' }).expect(409);
    // загрузка каталога: «kc-01» — то же изделие (обновление), а не новое с падением на 409
    const cat = 'Тип\tГруппа\tАртикул\tНаименование\nМАФ\tСкамьи\tkc-01\tСкамья парковая';
    expect((await http().post('/api/showcase/import').set(auth()).send({ text: cat, apply: true }).expect(200)).body).toMatchObject({ new: 0, update: 1, applied: true });
    // поиск: слова в любом порядке
    expect((await http().get('/api/showcase').query({ search: 'парковая скам' }).set(auth()).expect(200)).body.items.map((x: { sku: string }) => x.sku)).toEqual(['KC-01']);
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

  it('БЗ-5: варианты, себестоимость по последней закупке, паспорта изделия; позиция заказа привязывается по названию', async () => {
    const db = ctx!.connection.db!;
    const [p] = (await http().get('/api/showcase').query({ search: '1002' }).set(auth())).body.items;
    const ed = (await http().patch(`/api/showcase/${p.id}`).set(auth()).send({ colors: 'графит, зелёный, графит', sizes: '3×2 м' }).expect(200)).body;
    expect(ed).toMatchObject({ colors: ['графит', 'зелёный'], sizes: ['3×2 м'] });

    // себестоимость: труба — последняя закупка (старая дешевле не берётся), болт — цена справочника, краска — без цены
    const { insertedIds: m } = await db.collection('materials').insertMany([
      { name: 'Труба 40×40', unit: 'м', deletedAt: null }, { name: 'Болт M10', unit: 'шт', pricePerUnit: 12, deletedAt: null }, { name: 'Краска', unit: 'кг', deletedAt: null }]);
    await db.collection('supplyrequests').insertMany([
      { title: 'Труба', materialId: m[0], qty: 10, priceHint: 100, status: 'received', requestDate: new Date('2026-01-10'), deletedAt: null },
      { title: 'Труба', materialId: m[0], qty: 4, lineTotal: 600, status: 'received', requestDate: new Date('2026-03-10'), deletedAt: null },
      { title: 'Труба', materialId: m[0], qty: 1, priceHint: 999, status: 'cancelled', requestDate: new Date('2026-04-10'), deletedAt: null }]);
    const c = (await http().put(`/api/showcase/${p.id}/composition`).set(auth()).send({ lines: [{ materialId: String(m[0]), quantity: 2 }, { materialId: String(m[1]), quantity: 8 }, { materialId: String(m[2]), quantity: 1 }] }).expect(200)).body;
    expect(c.cost).toMatchObject({ total: 2 * 150 + 8 * 12, missing: 1 });
    expect(c.cost.lines.map((x: { source: string | null }) => x.source)).toEqual(['purchase', 'reference', null]);

    // СИ: вложенное изделие — строка product, цена — по его составу; старые строки-материалы не трогаются (types)
    const outer = (await http().post('/api/showcase').set(auth()).send({ sku: 'OUT-1', name: 'Комплекс', type: 'Спорт' }).expect(201)).body;
    const o1 = (await http().put(`/api/showcase/${outer.id}/composition`).set(auth()).send({ lines: [{ materialId: String(m[1]), quantity: 2 }] }).expect(200)).body;
    const o2 = (await http().put(`/api/showcase/${outer.id}/composition`).set(auth()).send({ lines: [{ lineType: 'product', productId: p.id, quantity: 2 }], types: ['product'] }).expect(200)).body;
    expect(o2.composition.map((l: { lineType: string }) => l.lineType).sort()).toEqual(['material', 'product']);
    expect(o2.cost.total).toBe(2 * 12 + 2 * (2 * 150 + 8 * 12));
    expect(o2.composition.find((l: { lineType: string }) => l.lineType === 'product').children).toHaveLength(3);
    expect(o1.composition).toHaveLength(1);
    // цикл: само в себя и через вложенное — 400
    await http().put(`/api/showcase/${outer.id}/composition`).set(auth()).send({ lines: [{ lineType: 'product', productId: outer.id, quantity: 1 }], types: ['product'] }).expect(400);
    const cyc = await http().put(`/api/showcase/${p.id}/composition`).set(auth()).send({ lines: [{ lineType: 'product', productId: outer.id, quantity: 1 }], types: ['product'] }).expect(400);
    expect(cyc.body.message).toMatch(/само в себя/);
    // похожие: у изделия той же группы в составе болт — подсказка для «outer» (своё не предлагается)
    expect((await http().get(`/api/showcase/${outer.id}/composition/similar`).set(auth()).expect(200)).body.items).toEqual(expect.any(Array));

    // паспорта: по ссылке и по названию
    await db.collection('productpassports').insertMany([
      { passportNumber: 'П-1', productId: new Types.ObjectId(p.id), name: 'другое', deletedAt: null },
      { passportNumber: 'П-2', name: 'Качели двойные', deletedAt: null }, { passportNumber: 'П-3', name: 'Качели двойные', deletedAt: new Date() }]);
    const card = (await http().get(`/api/showcase/${p.id}`).set(auth()).expect(200)).body;
    expect(card.passports.total).toBe(2);

    // позиция заказа: без productId — подбор по короткому названию; явный null — отвязать; размер сохраняется
    const inc = (await http().post('/api/incomes').set(auth()).send({ title: 'Качели двойные. Цвет: зелёный, оцинковка', size: '3×2 м' }).expect(201)).body;
    expect(inc).toMatchObject({ size: '3×2 м', product: { id: p.id, name: 'Качели двойные' } });
    const off = (await http().patch(`/api/incomes/${inc.id}`).set(auth()).send({ productId: null }).expect(200)).body;
    expect(off.product).toBeNull();
    const none = (await http().post('/api/incomes').set(auth()).send({ title: 'Неизвестное изделие' }).expect(201)).body;
    expect(none.product).toBeNull();
    expect((await http().get(`/api/showcase/${p.id}`).set(auth())).body.orderLines).toEqual([]); // позиции без заказа в «В заказах» не входят
  });

  it('«Из заказов» с выбором: создаются только отмеченные, с поправленным названием; неотмеченные позиции не трогаются', async () => {
    const db = ctx!.connection.db!;
    const orderId = new Types.ObjectId();
    const { insertedIds } = await db.collection('incomes').insertMany([
      { title: 'Горка «Волна». Цвет: синий', orderId, orderNo: '77', amount: 0, deletedAt: null },
      { title: 'Песочница «Ракушка»', orderId, orderNo: '77', amount: 0, deletedAt: null }]);
    const dry = (await http().post('/api/showcase/from-orders').set(auth()).send({}).expect(200)).body;
    expect(dry.items.map((x: { name: string }) => x.name).sort()).toEqual(['Горка «Волна»', 'Песочница «Ракушка»']);
    const key = dry.items.find((x: { name: string }) => x.name === 'Горка «Волна»').key;
    await http().post('/api/showcase/from-orders').set(auth()).send({ apply: true, picks: [] }).expect(400);
    const res = (await http().post('/api/showcase/from-orders').set(auth()).send({ apply: true, picks: [{ key, name: 'Горка Волна 1,5 м' }] }).expect(200)).body;
    expect(res.created).toBe(1);
    const [slide, sand] = await Promise.all([db.collection('incomes').findOne({ _id: insertedIds[0] }), db.collection('incomes').findOne({ _id: insertedIds[1] })]);
    expect((await db.collection('products').findOne({ _id: slide!.productId }))!.name).toBe('Горка Волна 1,5 м');
    expect(sand!.productId ?? null).toBeNull();
    expect((await http().post('/api/showcase/from-orders').set(auth()).send({}).expect(200)).body.items.map((x: { name: string }) => x.name)).toEqual(['Песочница «Ракушка»']);
  });
});
