import { Types } from 'mongoose';
import request from 'supertest';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { createTestApp, type TestContext } from '../setup/test-db';

describe('C198 — акты договора', () => {
  let ctx: TestContext;
  let admin: string;
  let restricted: string;
  let noDocs: string;
  const api = () => request(ctx.app.getHttpServer());
  const route = '/api/documents/acts';
  const live = new Types.ObjectId();
  const frozen = new Types.ObjectId();
  const liveFile = new Types.ObjectId();
  const frozenSource = new Types.ObjectId();
  const archivedFile = new Types.ObjectId().toString();

  async function account(username: string, appSections: string[], money: boolean) {
    const role = (await api().post('/api/roles').set(authHeader(admin)).send({
      label: username, baseRole: 'manager', money, appSections,
    }).expect(201)).body.name;
    const password = 'c198-test-password';
    await api().post('/api/admin/users').set(authHeader(admin)).send({ username, password, role }).expect(201);
    return (await api().post('/api/auth/login').send({ username, password }).expect(200)).body.access;
  }

  beforeAll(async () => {
    const uri = new URL(process.env.MONGO_URI ?? 'http://invalid');
    if (process.env.MONGO_DB_TEST !== 'datacore-test-c198-acts' || uri.protocol !== 'mongodb:' ||
      !['localhost', '127.0.0.1'].includes(uri.hostname) || !uri.port || ['27017', '27018', '27118'].includes(uri.port) ||
      uri.searchParams.get('directConnection') !== 'true') {
      throw new Error('C198 требует отдельную datacore-test-c198-acts на изолированной MongoDB');
    }
    ctx = await createTestApp({ strictValidation: true });
    admin = (await loginAsAdmin(ctx.app)).access;
    restricted = await account('c198-docs-only', ['docs'], false);
    noDocs = await account('c198-orders-only', ['salesorders'], true);
    const db = ctx.connection.db!;
    await db.collection('salesorders').insertMany([
      { _id: live, customer: 'Учебная мастерская', productionNo: '44-26', orderNo: 'А-218', deletedAt: null,
        legal: { documents: [
          { uid: 'live-act', kind: 'acceptance', fileId: liveFile, date: '2026-11-20', number: '1 + 2', gross: 200 },
          { uid: 'contract', kind: 'contract', date: '2026-11-19', number: 'C-218' },
        ] } },
      { _id: frozen, customer: 'Учебное производство', orderNo: 'A-219', activeArchiveVersion: 2, deletedAt: null,
        legal: { documents: [{ uid: 'frozen-act', kind: 'acceptance', fileId: frozenSource, date: '2026-11-21', number: '9' }] } },
      { orderNo: 'deleted', deletedAt: new Date(),
        legal: { documents: [{ uid: 'deleted-act', kind: 'acceptance', date: '2026-11-22' }] } },
    ]);
    await db.collection('salesorderarchives').insertMany([
      { orderId: frozen, version: 1, files: [{ id: new Types.ObjectId().toString(), kind: 'photo', sourceId: frozenSource }] },
      { orderId: frozen, version: 2, files: [{ id: archivedFile, kind: 'photo', sourceId: frozenSource }] },
    ]);
  });

  afterAll(async () => { await ctx?.cleanup(); });

  it('выдаёт только акты, в архиве возвращает файл текущей версии, в рабочем договоре — оригинал', async () => {
    const { body } = await api().get(route).set(authHeader(admin)).query({ limit: 1 }).expect(200);
    expect(body).toEqual({ page: 1, limit: 1, total: 2, items: [{
      id: frozen + ':frozen-act', orderId: String(frozen), customer: 'Учебное производство', orderNo: 'A-219',
      number: '9', date: '2026-11-21', name: 'Акт / УПД', archiveVersion: 2, fileId: archivedFile,
    }] });
    const next = (await api().get(route).set(authHeader(admin)).query({ page: 2, limit: 1 }).expect(200)).body;
    expect(next).toEqual({ page: 2, limit: 1, total: 2, items: [{
      id: live + ':live-act', orderId: String(live), customer: 'Учебная мастерская', orderNo: 'А-218', productionNo: '44-26',
      number: '1 + 2', date: '2026-11-20', name: 'Акт / УПД', fileId: String(liveFile),
    }] });
  });

  it('фильтрует буквальный текст, номер заказа и состояние', async () => {
    const get = (query: Record<string, string>) => api().get(route).set(authHeader(admin)).query(query).expect(200);
    expect((await get({ search: '1 + 2', order: '44-26', state: 'live' })).body.total).toBe(1);
    expect((await get({ search: '[0-9]*' })).body.total).toBe(0);
    expect((await get({ state: 'archived' })).body.items[0].orderId).toBe(String(frozen));
    await api().get(route).set(authHeader(admin)).query({ limit: 101 }).expect(400);
  });

  it('закрывает список без документации, оригиналы остаются за доступом к договорам и деньгам', async () => {
    await api().get(route).expect(401);
    await api().get(route).set(authHeader(noDocs)).expect(403);
    const rows = (await api().get(route).set(authHeader(restricted)).expect(200)).body.items;
    expect(rows).toHaveLength(2);
    expect(rows.every((item: { fileId: string | null }) => item.fileId === null)).toBe(true);
  });
});

