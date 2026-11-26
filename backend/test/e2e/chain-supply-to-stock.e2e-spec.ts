import request from 'supertest';
import { Types } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { StockMovement } from '../../src/modules/stock/schemas/stock-movement.schema';

/** Цепочка «заявка → счёт → оплата → Принять на склад»: остаток, цена, движение; повторный приём не удваивает приход. */
describe('Цепочка: снабжение до склада', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  let payerId: Types.ObjectId;
  let legacySupplierId: Types.ObjectId;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  const qtyOf = async (id: string) => (await http().get(`/api/stock/items/${id}`).set(auth()).expect(200)).body.quantity as number;
  const moves = (id: string) => db().collection('stockmovements').find({ materialId: new Types.ObjectId(id), type: 'in' }).toArray();
  const mkReq = async (b: object) => (await http().post('/api/supply/requests').set(auth()).send({ unit: 'шт', supplierName: 'Металл-Снаб', ...b }).expect(201)).body.id as string;
  const mkLegacyReq = async (title: string, qty: number) => {
    const row = await db().collection('supplyrequests').insertOne({
      title, qty, unit: 'шт', supplierId: legacySupplierId, priority: 'normal', status: 'requested', paid: false, deletedAt: null,
    }, { writeConcern: { w: 'majority' } });
    return String(row.insertedId);
  };
  const invoiceOf = async (reqId: string, amount: number, no: string) => {
    // цена строки — до счёта: у заявки priceHint — сумма строки (счёт считает amount сам)
    await http().patch(`/api/supply/requests/${reqId}`).set(auth()).send({ priceHint: amount }).expect(200);
    const inv = (await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [reqId] }).expect(201)).body.items[0].id as string;
    await http().patch(`/api/supply/invoices/${inv}`).set(auth()).send({ no, date: '2026-10-20', payerCompanyId: String(payerId), issue: true }).expect(200);
    return inv;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['supplyrequests', 'supplyinvoices', 'organizations', 'materials', 'materialprices', 'storageitems', 'stockmovements', 'reservations', 'warehouses']) await db().collection(c).deleteMany({});
    payerId = new Types.ObjectId();
    await db().collection('organizations').insertOne({ _id: payerId, name: 'Наша компания цепочки', inn: '9900007158', isOurCompany: true, deletedAt: null });
    legacySupplierId = (await db().collection('organizations').insertOne({ name: 'Поставщик цепочки C165', inn: '9900007166', type: ['supplier'], deletedAt: null })).insertedId;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  let matId = '', reqId = '', invId = '';

  it('заявка на позицию склада → счёт → оплата: до приёма остаток 0, заявка оплачена', async () => {
    matId = (await http().post('/api/stock/items').set(auth()).send({ name: 'Лист ЦС-1', unit: 'шт', categoryName: 'Металл' }).expect(201)).body.id;
    reqId = await mkReq({ title: 'Лист ЦС-1', qty: 10, materialId: matId, priceHint: 1 });
    invId = await invoiceOf(reqId, 1200, 'ЦС-7');
    const paid = (await http().post(`/api/supply/invoices/${invId}/pay`).set(auth()).expect(200)).body;
    expect(paid.status).toBe('paid');
    expect(await db().collection('supplyrequests').findOne({ _id: new Types.ObjectId(reqId) })).toMatchObject({ paid: true, invoiceNo: 'ЦС-7' });
    expect(await qtyOf(matId)).toBe(0);
    expect(await moves(matId)).toHaveLength(0);
  });

  it('«Принять» счёт: остаток 10, заявка «Получено» на склад, движение прихода со ссылкой на заявку', async () => {
    const r = (await http().post(`/api/supply/invoices/${invId}/receive`).set(auth()).send({}).expect(200)).body;
    expect(r.receivedCount).toBe(1);
    expect(await qtyOf(matId)).toBe(10);
    expect(await db().collection('supplyrequests').findOne({ _id: new Types.ObjectId(reqId) })).toMatchObject({ status: 'received', receivedQty: 10, receivedTo: 'stock' });
    const mv = await moves(matId);
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ qty: 10, delta: 10, qtyBefore: 0, qtyAfter: 10, documentRef: `SupplyRequest:${reqId}` });
    const hist = (await http().get(`/api/stock/items/${matId}/history`).set(auth()).expect(200)).body;
    expect(hist.items).toHaveLength(1);
  });

  it('цена записана: история цен материала — выставлен и оплачен (1200 с НДС / 10 = 100 без НДС)', async () => {
    const h = (await http().get(`/api/materials/${matId}/prices`).set(auth()).expect(200)).body;
    expect(h.total).toBe(2);
    expect(h.items.map((p: { source: string }) => p.source).sort()).toEqual(['invoice_issued', 'invoice_paid']);
    for (const p of h.items) expect(p).toMatchObject({ price: 100, priceWithVat: 120, supplierName: 'Металл-Снаб' });
    expect((await http().get(`/api/materials/${matId}/price-default`).set(auth()).expect(200)).body).toMatchObject({ price: 100, supplierName: 'Металл-Снаб' });
  });

  it('повторный «Принять» — 409, приход не удвоен: остаток 10, одно движение', async () => {
    const r = await http().post(`/api/supply/invoices/${invId}/receive`).set(auth()).send({}).expect(409);
    expect(r.body.message).toContain('уже приняты');
    await http().post(`/api/supply/requests/${reqId}/receive`).set(auth()).send({ qty: 10 }).expect(409);
    await http().post(`/api/supply/invoices/${invId}/receive`).set(auth()).send({ requestIds: [reqId] }).expect(409);
    expect(await qtyOf(matId)).toBe(10);
    expect(await moves(matId)).toHaveLength(1);
  });

  it('ОШИБКА СЕРВЕРА: два «Принять» одновременно удваивают приход (ждём остаток 10 и одно движение, сейчас 20)', async () => {
    const m = (await http().post('/api/stock/items').set(auth()).send({ name: 'Лист ЦС-2', unit: 'шт', categoryName: 'Металл' }).expect(201)).body.id as string;
    const r = await mkReq({ title: 'Лист ЦС-2', qty: 10, materialId: m, priceHint: 1 });
    const inv = await invoiceOf(r, 600, 'ЦС-8');
    const res = await Promise.all([1, 2].map(() => http().post(`/api/supply/invoices/${inv}/receive`).set(auth()).send({})));
    expect(res.filter((x) => x.status >= 500)).toEqual([]);
    // ключ приёма одинаков (inv-…-заявка): второй вызов — тот же результат (200) или 409, но не второй приход
    expect(res.every((x) => x.status === 200 || x.status === 409)).toBe(true);
    expect(await qtyOf(m)).toBe(10);
    expect(await moves(m)).toHaveLength(1);
  });

  it('HARDEN-1: приём → отмена движения → смена статуса → новый приём увеличивает остаток', async () => {
    const m = (await http().post('/api/stock/items').set(auth()).send({ name: 'Лист ЦС-H4', unit: 'шт', categoryName: 'Металл' }).expect(201)).body.id as string;
    const r = await mkReq({ title: 'Лист ЦС-H4', qty: 10, materialId: m, priceHint: 1 });
    await invoiceOf(r, 600, 'ЦС-40');
    await http().post(`/api/supply/requests/${r}/receive`).set(auth()).send({}).expect(200);
    expect(await qtyOf(m)).toBe(10);
    // активный приход — статус менять нельзя
    await http().patch(`/api/supply/requests/${r}`).set(auth()).send({ statusLabel: '⚙️ В работе' }).expect(400);
    const mv = (await moves(m))[0];
    await http().post(`/api/stock/movements/${String(mv._id)}/cancel`).set(auth()).expect(200);
    expect(await qtyOf(m)).toBe(0);
    await http().patch(`/api/supply/requests/${r}`).set(auth()).send({ statusLabel: '⚙️ В работе' }).expect(200);
    await http().post(`/api/supply/requests/${r}/receive`).set(auth()).send({}).expect(200);
    expect(await qtyOf(m)).toBe(10);
  });

  it('HARDEN-1: две параллельные отмены одной операции — остаток возвращается один раз', async () => {
    const m = (await http().post('/api/stock/items').set(auth()).send({ name: 'Лист ЦС-H5', unit: 'шт', categoryName: 'Металл' }).expect(201)).body.id as string;
    const b = (await http().post('/api/stock/batch').set(auth()).send({ type: 'in', lines: [{ materialId: m, qty: 10 }] }).expect(201)).body.batchId as string;
    await http().post('/api/stock/batch').set(auth()).send({ type: 'in', lines: [{ materialId: m, qty: 5 }] }).expect(201);
    expect(await qtyOf(m)).toBe(15);
    const res = await Promise.all([1, 2].map(() => http().post(`/api/stock/batch/${b}/cancel`).set(auth())));
    expect(res.filter((x) => x.status >= 500)).toEqual([]);
    expect(res.filter((x) => x.status === 201 || x.status === 200)).toHaveLength(1);
    expect(await qtyOf(m)).toBe(5);
  });

  it('частичный приход по заявке: остаток +4, заявка открыта на 6, итог после остатка 10 и заявка «Получено»', async () => {
    const m = (await http().post('/api/stock/items').set(auth()).send({ name: 'Лист ЦС-3', unit: 'шт', categoryName: 'Металл' }).expect(201)).body.id as string;
    const r = await mkReq({ title: 'Лист ЦС-3', qty: 10, materialId: m, priceHint: 1 });
    await invoiceOf(r, 600, 'ЦС-9');
    const part = (await http().post(`/api/supply/requests/${r}/receive`).set(auth()).send({ qty: 4, partial: true, clientUid: 'cs-p1' }).expect(200)).body;
    expect(part).toMatchObject({ qty: 6, receivedQty: 4 });
    expect(part.status).not.toBe('received');
    expect(await qtyOf(m)).toBe(4);
    // повтор той же части (офлайн-очередь) — без второго прихода
    await http().post(`/api/supply/requests/${r}/receive`).set(auth()).send({ qty: 4, partial: true, clientUid: 'cs-p1' }).expect(200);
    expect(await qtyOf(m)).toBe(4);
    expect(await moves(m)).toHaveLength(1);
    const acceptAnotherPart = await http().post(`/api/supply/requests/${r}/receive`).set(auth()).send({ qty: 2, partial: true, clientUid: 'cs-p2' }).expect(200);
    expect(acceptAnotherPart.body).toMatchObject({ qty: 4, receivedQty: 6 });
    // Старый ключ остаётся идемпотентным даже после записи новой части.
    const previous = await http().post(`/api/supply/requests/${r}/receive`).set(auth()).send({ qty: 4, partial: true, clientUid: 'cs-p1' }).expect(200);
    expect(previous.body).toMatchObject({ qty: 4, receivedQty: 6 });
    expect(await qtyOf(m)).toBe(6);
    expect(await moves(m)).toHaveLength(2);
    // остаток пришёл
    const rest = (await http().post(`/api/supply/requests/${r}/receive`).set(auth()).send({ qty: 4 }).expect(200)).body;
    expect(rest.status).toBe('received');
    expect(await qtyOf(m)).toBe(10);
    expect(await moves(m)).toHaveLength(3);
    await http().post(`/api/supply/requests/${r}/receive`).set(auth()).send({ qty: 4 }).expect(409);
    expect(await qtyOf(m)).toBe(10);
  });

  it('счёт из двух заявок: «Принять» с одной отмеченной принимает только её; затем остальные', async () => {
    const m1 = (await http().post('/api/stock/items').set(auth()).send({ name: 'Лист ЦС-4', unit: 'шт', categoryName: 'Металл' }).expect(201)).body.id as string;
    const m2 = (await http().post('/api/stock/items').set(auth()).send({ name: 'Лист ЦС-5', unit: 'шт', categoryName: 'Металл' }).expect(201)).body.id as string;
    const a = await mkReq({ title: 'Лист ЦС-4', qty: 3, materialId: m1, priceHint: 100 });
    const b = await mkReq({ title: 'Лист ЦС-5', qty: 5, materialId: m2, priceHint: 100 });
    const inv = (await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [a, b] }).expect(201)).body.items[0].id as string;
    const payer = String((await db().collection('organizations').findOne({ name: 'Металл-Снаб' }))!._id);
    await http().patch(`/api/supply/invoices/${inv}`).set(auth()).send({ no: 'ЦС-10', date: '2026-10-20', payerCompanyId: payer, issue: true }).expect(200);
    const one = (await http().post(`/api/supply/invoices/${inv}/receive`).set(auth()).send({ requestIds: [a] }).expect(200)).body;
    expect(one.receivedCount).toBe(1);
    expect([await qtyOf(m1), await qtyOf(m2)]).toEqual([3, 0]);
    const rest = (await http().post(`/api/supply/invoices/${inv}/receive`).set(auth()).send({}).expect(200)).body;
    expect(rest.receivedCount).toBe(1);
    expect([await qtyOf(m1), await qtyOf(m2)]).toEqual([3, 5]);
    await http().post(`/api/supply/invoices/${inv}/receive`).set(auth()).send({}).expect(409);
  });

  it('заявка без привязки к позиции: «Принять» заводит позицию склада по названию, один приход', async () => {
    const r = await mkReq({ title: 'Новая позиция ЦС-6', qty: 7, priceHint: 10 });
    const inv = (await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [r] }).expect(201)).body.items[0].id as string;
    const payer = String((await db().collection('organizations').findOne({ name: 'Металл-Снаб' }))!._id);
    await http().patch(`/api/supply/invoices/${inv}`).set(auth()).send({ no: 'ЦС-11', date: '2026-10-20', payerCompanyId: payer, issue: true }).expect(200);
    await http().post(`/api/supply/invoices/${inv}/receive`).set(auth()).send({}).expect(200);
    const items = (await http().get('/api/stock/items').query({ search: 'ЦС-6' }).set(auth()).expect(200)).body;
    expect(items.total).toBe(1);
    expect(items.items[0]).toMatchObject({ name: 'Новая позиция ЦС-6', quantity: 7 });
  });

  it('приход новой позиции: отказ вставки движения откатывает материал, ячейку, заявку и границу счёта', async () => {
    const name = 'Материал ЦС-C165 после отказа';
    const req = await mkLegacyReq(name, 4);
    const inv = await invoiceOf(req, 480, 'ЦС-C165');
    const source = { _id: new Types.ObjectId(req) };
    const header = { _id: new Types.ObjectId(inv) };
    const query = { documentRef: `SupplyRequest:${req}` };
    const requests = db().collection('supplyrequests');
    const invoices = db().collection('supplyinvoices');
    const materials = db().collection('materials');
    const storage = db().collection('storageitems');
    const movements = db().collection('stockmovements');
    const before = await Promise.all([requests.findOne(source), invoices.findOne(header), storage.countDocuments()]);
    expect(before[0]?.materialId).toBeUndefined();
    expect(await materials.countDocuments({ name })).toBe(0);
    const accept = () => http().post(`/api/supply/requests/${req}/receive`).set(auth()).send({ qty: 4, clientUid: 'chain-c165-retry' });
    const insertion = jest.spyOn(ctx!.connection.model(StockMovement.name), 'create').mockRejectedValueOnce(new Error('Учебный отказ записи движения'));
    try {
      await accept().expect(500);
      expect(insertion).toHaveBeenCalledTimes(1);
    } finally { insertion.mockRestore(); }
    expect(await materials.countDocuments({ name })).toBe(0);
    expect(await movements.countDocuments(query)).toBe(0);
    expect(await Promise.all([requests.findOne(source), invoices.findOne(header), storage.countDocuments()])).toEqual(before);

    await accept().expect(200);
    const replay = await accept().expect(200);
    expect(replay.body).not.toHaveProperty('receiveUid');
    const material = await materials.findOne({ name });
    expect(material).not.toBeNull();
    expect(await materials.countDocuments({ name })).toBe(1);
    const cells = await storage.find({ materialId: material!._id }).toArray();
    expect(cells).toHaveLength(1);
    expect(cells[0].quantity).toBe(4);
    expect(await movements.countDocuments(query)).toBe(1);
    expect(await requests.findOne(source)).toMatchObject({ materialId: material!._id, status: 'received', receivedQty: 4 });
  });

  it('два одновременных приёма новой позиции оставляют один материал и одно движение', async () => {
    const name = 'Новая позиция ЦС-C165 два входа';
    const req = await mkLegacyReq(name, 7);
    const responses = await Promise.all(['c165-concurrent-1', 'c165-concurrent-2'].map(clientUid =>
      http().post(`/api/supply/requests/${req}/receive`).set(auth()).send({ qty: 7, clientUid }),
    ));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const materials = await db().collection('materials').find({ name }).toArray();
    expect(materials).toHaveLength(1);
    expect(await moves(String(materials[0]._id))).toHaveLength(1);
    expect(await qtyOf(String(materials[0]._id))).toBe(7);
  });

  it('ключ другого прихода отклоняется до изменения заявки или артикула материала', async () => {
    const first = await mkReq({ title: 'ЦС-C165 занятый ключ', qty: 3 });
    const second = await mkReq({ title: 'ЦС-C165 отдельный материал', qty: 2 });
    const reqs = db().collection('supplyrequests');
    const query = { _id: new Types.ObjectId(second) };
    await reqs.updateOne(query, { $set: { article: 'ЦС-C165-артикул' } });
    const before = await reqs.findOne(query);
    const beforeMaterial = await db().collection('materials').findOne({ _id: before!.materialId });
    const accept = (id: string, qty: number) => http().post(`/api/supply/requests/${id}/receive`).set(auth()).send({ qty, clientUid: 'chain-c165-one-operation' });
    await accept(first, 3).expect(200);
    await accept(second, 2).expect(409);
    expect(await reqs.findOne(query)).toEqual(before);
    expect(await db().collection('materials').findOne({ _id: before!.materialId })).toEqual(beforeMaterial);
    expect(await qtyOf(String(before!.materialId))).toBe(0);
    await accept(first, 3).expect(200);
    expect(await db().collection('stockmovements').countDocuments({ clientUid: 'chain-c165-one-operation' })).toBe(1);
  });

  it('прямая поставка связывает только выбранную позицию с заказом и сохраняет остатки при повторе', async () => {
    const orderId = new Types.ObjectId();
    await db().collection('salesorders').insertOne({ _id: orderId, orderNo: 'ЦС-Д1', productionNo: 'ЦС-О1', customer: 'Учебный заказчик', stage: 'production', deletedAt: null });
    const material = (await http().post('/api/stock/items').set(auth()).send({ name: 'Материал ЦС-объект', unit: 'шт', categoryName: 'Металл' }).expect(201)).body.id;
    const direct = await mkReq({ title: 'Прямая позиция ЦС', qty: 3, priceHint: 100 });
    const stock = await mkReq({ title: 'Материал ЦС-объект', materialId: material, qty: 5, priceHint: 200 });
    const invoice = (await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [direct, stock] }).expect(201)).body.items[0].id as string;
    const accept = (body: object) => http().post(`/api/supply/invoices/${invoice}/receive`).set(auth()).send(body);
    const body = { requestIds: [direct], directOrderId: String(orderId) };

    const materialCount = await db().collection('materials').countDocuments();
    const storageCount = await db().collection('storageitems').countDocuments();
    await accept({ directOrderId: String(orderId) }).expect(400);
    const setFlag = (key: string, enabledByDefault: boolean) => http().put(`/api/feature-flags/${key}`).set(auth()).send({ enabledByDefault }).expect(200);
    const receiveFlag = 'c265.supply.receive.api';
    const requestFlag = 'c262.supply.requests.api';
    const requests = db().collection('supplyrequests');
    const firstRow = { _id: new Types.ObjectId(direct) };
    const before = await requests.findOne(firstRow);
    try {
      await setFlag(receiveFlag, false);
      const rejected = await accept(body).expect(409);
      expect(rejected.body.message).toContain(receiveFlag);
      expect(await requests.findOne(firstRow)).toEqual(before);
    } finally { await setFlag(receiveFlag, true); }
    const deliveries = await (async () => {
      await setFlag(requestFlag, false);
      try { return await Promise.all([accept(body).expect(200), accept(body).expect(200)]); }
      finally { await setFlag(requestFlag, true); }
    })();
    expect(deliveries.map(response => response.body.receivedCount).sort()).toEqual([0, 1]);
    const result = deliveries.find(response => response.body.receivedCount === 1)!.body;
    expect(result.requests.find((row: { id: string }) => row.id === direct)).toMatchObject({ receivedTo: 'direct', status: 'received', receivedQty: 3, costCenter: 'order', salesOrderId: String(orderId), orderLabel: 'Заказ № ЦС-О1 · Учебный заказчик' });
    expect(result.requests.find((row: { id: string }) => row.id === stock)).not.toMatchObject({ status: 'received' });
    expect((await accept(body).expect(200)).body.receivedCount).toBe(0);
    expect(await db().collection('stockmovements').countDocuments({ documentRef: `SupplyRequest:${direct}` })).toBe(0);
    expect(await db().collection('materials').countDocuments()).toBe(materialCount);
    expect(await db().collection('storageitems').countDocuments()).toBe(storageCount);
    expect(await qtyOf(material)).toBe(0);
    expect((await accept({ requestIds: [stock] }).expect(200)).body.receivedCount).toBe(1);
    expect(await qtyOf(material)).toBe(5);
    expect(await moves(material)).toHaveLength(1);
  });

  it.each([['office', 'На офис'], ['workshop', 'На цех'], ['smr', 'Площадка парка']])
    ('прямая приёмка %s учитывает назначение и последующую оплату без склада', async (costCenter, label) => {
      const material = (await http().post('/api/stock/items').set(auth()).send({ name: 'Материал для ' + label, unit: 'шт' }).expect(201)).body.id;
      const row = await mkReq({ title: 'Поставка ' + label, qty: 3, materialId: material, priceHint: 100 });
      const invoice = await invoiceOf(row, 600, 'ЦС-' + costCenter);
      const accept = (body: object) => http().post('/api/supply/invoices/' + invoice + '/receive').set(auth()).send(body);
      const body = { requestIds: [row], directCostCenter: costCenter, ...(costCenter === 'smr' ? { directCostObject: ' ' + label + ' ' } : {}) };
      await accept({ directCostCenter: costCenter }).expect(400);
      await accept({ ...body, directOrderId: String(new Types.ObjectId()) }).expect(400);
      const result = await accept(body).expect(200);
      expect(result.body.receivedCount).toBe(1);
      const received = result.body.requests.find(({ id }: { id: string }) => id === row);
      expect(received).toMatchObject({ status: 'received', receivedTo: 'direct', receivedQty: 3, costCenter });
      expect(received.salesOrderId).toBeFalsy();
      if (costCenter === 'smr') expect(received.costObject).toBe(label);
      expect((await accept(body).expect(200)).body.receivedCount).toBe(0);
      await accept({ requestIds: [row], directCostCenter: costCenter === 'office' ? 'workshop' : 'office' }).expect(409);
      expect(await qtyOf(material)).toBe(0);
      expect(await moves(material)).toHaveLength(0);
      await http().post('/api/supply/invoices/' + invoice + '/payments').set(auth())
        .send({ clientUid: 'direct-' + costCenter, date: '2026-10-22', amount: 600 }).expect(200);
      const paid = (await http().get('/api/finance/operations').set(auth())
        .query({ from: '2026-10-22', to: '2026-10-22', companyId: String(payerId), costCenter }).expect(200)).body;
      expect(paid.items).toHaveLength(1);
      expect(paid.items[0]).toMatchObject({ amount: 600, costCenter, ...(costCenter === 'smr' ? { costObject: label } : {}) });
    });

  it('прямой приём разных заказов отклоняет всю отмеченную партию', async () => {
    const firstOrder = new Types.ObjectId();
    const secondOrder = new Types.ObjectId();
    await db().collection('salesorders').insertMany([
      { _id: firstOrder, orderNo: 'ЦС-О2', stage: 'production', deletedAt: null },
      { _id: secondOrder, orderNo: 'ЦС-О3', stage: 'production', deletedAt: null },
    ]);
    const a = await mkReq({ title: 'Строка без заказа', qty: 2, priceHint: 100 });
    const b = await mkReq({ title: 'Строка другого заказа', qty: 2, priceHint: 100, salesOrderId: String(secondOrder) });
    const invoice = (await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [a, b] }).expect(201)).body.items[0].id;
    await http().post(`/api/supply/invoices/${invoice}/receive`).set(auth()).send({ requestIds: [a, b], directOrderId: String(firstOrder) }).expect(409);
    await http().post(`/api/supply/invoices/${invoice}/receive`).set(auth()).send({ requestIds: [a, b], directCostCenter: 'office' }).expect(409);
    const rows = await db().collection('supplyrequests').find({ _id: { $in: [new Types.ObjectId(a), new Types.ObjectId(b)] } }).toArray();
    expect(rows.map(row => row.status)).not.toContain('received');
    expect(rows.find(row => String(row._id) === b)?.salesOrderId).toEqual(secondOrder);
    expect(await db().collection('stockmovements').countDocuments({ documentRef: { $in: [`SupplyRequest:${a}`, `SupplyRequest:${b}`] } })).toBe(0);
  });
});
