import { createConnection, Types, type Connection } from 'mongoose';
import { execFile } from 'child_process';
import { join } from 'path';
import { promisify } from 'util';
import { withOrderWrite } from '../../src/common/order-archive/write';
import { CollectionsAdminController } from '../../src/modules/admin/collections-admin.controller';
import { DictsService } from '../../src/modules/dicts/dicts.service';
import { FinancialClassificationService } from '../../src/modules/finance/financial-classification.service';
import { MatchingService } from '../../src/modules/matching/matching.service';
import { describeModels } from '../../src/modules/meta/meta-schema';
import { ProductRequestsService } from '../../src/modules/product-requests/product-requests.service';
import { ProductRequest, ProductRequestSchema } from '../../src/modules/product-requests/product-request.schema';

describe('C188 — внешние писатели', () => {
  const oid = () => new Types.ObjectId();
  let connection: Connection;
  const db = () => connection.db!;
  const matching = () => new MatchingService(connection, { updateOne: () => ({ exec: async () => ({}) }) } as never, { log: async () => undefined } as never);

  let uri: string;
  beforeAll(async () => {
    const explicitUri = process.env.C188_EXTERNAL_MONGO;
    const target = new URL(explicitUri ?? process.env.MONGO_URI ?? 'mongodb://localhost:27017/?replicaSet=rs0');
    if (target.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(target.hostname)) {
      throw new Error('C188 требует локальную MongoDB');
    }
    if (explicitUri && target.pathname !== '/datacore-test-c188-external') {
      throw new Error('C188_EXTERNAL_MONGO должна указывать на datacore-test-c188-external');
    }
    target.pathname = '/datacore-test-c188-external';
    target.searchParams.set('directConnection', 'true');
    uri = target.toString();
    connection = await createConnection(uri).asPromise();
    for (const name of ['salesorders', 'incomes', 'products', 'productrequests', 'organizations', 'auditlogs', 'dict_values', 'salesorderarchives', 'salesorderarchivereopens', 'salesorderarchivechunks']) {
      if (!(await db().listCollections({ name }).hasNext())) await db().createCollection(name);
    }
  });

  afterAll(async () => { await connection?.close(); });

  it('сопоставление пачки не меняет ни одной позиции при архивном договоре', async () => {
    const archived = oid(), open = oid(), line = oid(), liveLine = oid();
    await db().collection('salesorders').insertMany([{ _id: archived, activeArchiveVersion: 1 }, { _id: open }]);
    await db().collection('incomes').insertMany([{ _id: line, orderId: archived }, { _id: liveLine, orderId: open }]);
    const service = matching();
    await expect(service.bulk([{ lineId: String(liveLine), productId: null }, { lineId: String(line), productId: null }]))
      .rejects.toMatchObject({ response: { code: 'ORDER_ARCHIVED' } });
    expect(await db().collection('incomes').findOne({ _id: liveLine })).not.toHaveProperty('matchStatus');
    await service.none(String(liveLine));
    expect(await db().collection('incomes').findOne({ _id: liveLine })).toHaveProperty('matchStatus', 'none');
  });

  it('справочник объединяется и меняет только живые строки, шапки и запись справочника', async () => {
    const archived = oid(), open = oid(), line = oid(), liveLine = oid(), from = oid(), to = oid();
    const oldForm = 'Форма C188 ' + from, newForm = 'Форма C188 ' + to;
    await db().collection('dict_values').insertMany([
      { _id: from, dict: 'paymentForms', name: oldForm }, { _id: to, dict: 'paymentForms', name: newForm },
    ]);
    await db().collection('salesorders').insertMany([{ _id: archived, paymentForm: oldForm, activeArchiveVersion: 2 }, { _id: open, paymentForm: oldForm }]);
    await db().collection('incomes').insertMany([{ _id: line, orderId: archived, paymentForm: oldForm }, { _id: liveLine, orderId: open, paymentForm: oldForm }]);
    await expect(new DictsService(connection).merge('paymentForms', String(from), String(to), { role: 'admin' }))
      .resolves.toMatchObject({ moved: 1, archiveSkipped: 2 });
    expect(await db().collection('incomes').findOne({ _id: line })).toHaveProperty('paymentForm', oldForm);
    expect(await db().collection('salesorders').findOne({ _id: archived })).toHaveProperty('paymentForm', oldForm);
    expect(await db().collection('incomes').findOne({ _id: liveLine })).toHaveProperty('paymentForm', newForm);
    expect(await db().collection('salesorders').findOne({ _id: open })).toHaveProperty('paymentForm', newForm);
  });

  it('фиксация побеждает конкурентную классификацию платежа', async () => {
    const order = oid(), line = oid(), company = oid();
    const paymentId = String(oid());
    await db().collection('salesorders').insertOne({ _id: order });
    await db().collection('incomes').insertOne({ _id: line, orderId: order, companyId: company, payments: [{ paymentId, amount: 1, companyId: company, date: new Date() }] });
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    let claimed!: () => void;
    const entered = new Promise<void>(resolve => { claimed = resolve; });
    const archive = withOrderWrite(connection, [order], async session => {
      await db().collection('salesorders').updateOne({ _id: order }, { $set: { activeArchiveVersion: 1 } }, { session });
      claimed();
      await wait;
    });
    await entered;
    const classification = new FinancialClassificationService(connection, {} as never);
    const apply = classification.apply(`income:${line}:${paymentId}`, { reason: 'Проверка', costCenter: 'Тест', version: 0, clientUid: 'c188' }, { id: String(oid()), username: 'c188', role: 'admin' } as never, null);
    const refused = expect(apply).rejects.toMatchObject({ response: { code: 'ORDER_ARCHIVED' } });
    release();
    await archive;
    await refused;
    expect((await db().collection('incomes').findOne({ _id: line }))?.payments[0]).not.toHaveProperty('classificationVersion');
  });

  it('новое изделие из архивной позиции не создаёт заявку или товар', async () => {
    const archived = oid(), line = oid(), req = oid(), existing = oid();
    const title = 'Товар ' + req;
    await db().collection('salesorders').insertOne({ _id: archived, activeArchiveVersion: 1 });
    await db().collection('incomes').insertOne({ _id: line, orderId: archived, productRequestId: req, title, unitPrice: 1, qty: 1 });
    await db().collection('productrequests').insertOne({ _id: req, title, titleKey: title, status: 'open' });
    await db().collection('products').insertOne({ _id: existing, sku: String(existing) });
    const model = connection.model(ProductRequest.name, ProductRequestSchema);
    const createRecord = jest.fn();
    const service = new ProductRequestsService(connection, model as never, { createRecord } as never, {} as never);
    await expect(service.create({ incomeId: String(line) })).rejects.toMatchObject({ response: { code: 'ORDER_ARCHIVED' } });
    await expect(service.confirm(String(req), {})).rejects.toMatchObject({ response: { code: 'ORDER_ARCHIVED' } });
    await expect(service.reject(String(req), String(existing))).rejects.toMatchObject({ response: { code: 'ORDER_ARCHIVED' } });
    expect(createRecord).not.toHaveBeenCalled();
    expect(await db().collection('productrequests').findOne({ _id: req })).toHaveProperty('status', 'open');
  });

  it('raw admin и meta не отдают служебные коллекции', async () => {
    const controller = new CollectionsAdminController(connection);
    for (const name of ['salesorderarchives', 'salesorderarchivereopens', 'salesorderarchivechunks']) {
      await expect(controller.docs(name, {})).rejects.toMatchObject({ status: 409 });
      await expect(controller.detail(name)).rejects.toMatchObject({ status: 409 });
      await expect(controller.remove(name)).rejects.toMatchObject({ status: 409 });
    }
    expect((await controller.list()).items.map(item => item.name)).not.toEqual(expect.arrayContaining(['salesorderarchives']));
    expect(describeModels({ models: { snapshot: { collection: { collectionName: 'salesorderarchives' } } } } as never)).toEqual([]);
  });

  it('штатный CLI выставляет компанию живому договору и пропускает архивный', async () => {
    const archived = oid(), live = oid(), company = oid(), line = oid(), liveLine = oid();
    const key = String(company).toUpperCase(), name = `C188 ${company}`;
    await db().collection('organizations').insertOne({ _id: company, name, isOurCompany: true });
    await db().collection('salesorders').insertMany([
      { _id: archived, importKey: `${key}|архив`, activeArchiveVersion: 2 }, { _id: live, importKey: `${key}|действующий` },
    ]);
    await db().collection('incomes').insertMany([{ _id: line, orderId: archived }, { _id: liveLine, orderId: live }]);
    const run = promisify(execFile);
    const result = await run(process.execPath, [join(__dirname, '../../scripts/add-our-company.js'), '--name', name, '--key', key, '--apply'], {
      env: { ...process.env, MONGO_URI: uri, MONGO_DB: 'datacore-test-c188-external' },
    });
    expect(result.stdout).toContain('Архивных договоров пропущено: 1');
    expect(await db().collection('salesorders').findOne({ _id: archived })).not.toHaveProperty('companyId');
    expect(await db().collection('incomes').findOne({ _id: line })).not.toHaveProperty('companyId');
    expect(await db().collection('salesorders').findOne({ _id: live })).toHaveProperty('companyId', company);
    expect(await db().collection('incomes').findOne({ _id: liveLine })).toHaveProperty('companyId', company);
  });
});
