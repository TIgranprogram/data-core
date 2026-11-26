import request from 'supertest';
import { FeatureFlag } from '../../src/modules/feature-flag/feature-flag.schema';
import { FeatureFlagService } from '../../src/modules/feature-flag/feature-flag.service';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';

const slices = {
  warehouse: 'c260.warehouses.api',
  material: 'c261.materials.card.api',
  request: 'c262.supply.requests.api',
  movement: 'c263.stock.move.api',
  reserve: 'c264.stock.reserve.api',
  receipt: 'c265.supply.receive.api',
} as const;

describe('C274: запись API при переключении C260–C265', () => {
  let ctx: TestContext;
  let token: string;
  const http = () => request(ctx.app.getHttpServer());
  const auth = () => authHeader(token);
  const post = (path: string, body: object) => http().post(`/api/${path}`).set(auth()).send(body);
  const flag = (key: string) => http().get(`/api/feature-flags/${key}`).set(auth()).expect(200);
  const setFlag = (key: string, body: { enabledByDefault: boolean; isActive: boolean; label?: string }) =>
    http().put(`/api/feature-flags/${key}`).set(auth()).send(body).expect(200);

  async function start(preserveDatabase = false) {
    ctx = await createTestApp({ preserveDatabase, strictValidation: true });
    token = (await loginAsAdmin(ctx.app)).access;
  }

  beforeAll(async () => {
    const db = process.env.MONGO_DB_TEST ?? 'datacore-test';
    const uri = new URL(process.env.MONGO_URI ?? 'mongodb://localhost:27017/datacore');
    if (!/^datacore-test(?:-[a-z0-9-]+)?$/.test(db) || !['localhost', '127.0.0.1'].includes(uri.hostname)) {
      throw new Error('C274: нужна изолированная локальная БД datacore-test*');
    }
    await start();
  });

  afterAll(async () => { await ctx?.cleanup(); });

  it('одновременная первичная инициализация оставляет один флаг', async () => {
    const flags = ctx.module.get(FeatureFlagService);
    const model = ctx.connection.model(FeatureFlag.name);
    await model.init();
    const key = 'c274.concurrent.seed';
    const initial = { label: 'Учения', enabledByDefault: true, category: 'test', isActive: true };
    const created = await Promise.all(Array.from({ length: 8 }, () => flags.seedDefault(key, initial)));
    expect(created.filter(Boolean)).toHaveLength(1);
    expect(await model.countDocuments({ key })).toBe(1);
  });

  it('новая БД отдаёт запись API, аварийные настройки переживают перезапуск, запись API можно вернуть', async () => {
    for (const key of Object.values(slices)) {
      expect((await flag(key)).body).toMatchObject({ enabledByDefault: true, isActive: true });
    }
    await post('stock/warehouses', { name: 'Склад учений' }).expect(201);
    const item = (await post('stock/items', { name: 'Болт для учений', unit: 'шт' }).expect(201)).body;
    const req = (await post('supply/requests', { title: 'Гайки для учений', qty: 4, unit: 'шт' }).expect(201)).body;
    const entry = (await post('supply/requests', { title: 'Шайбы для учений', qty: 2, unit: 'шт' }).expect(201)).body;
    await post(`stock/items/${item.id}/move`, { type: 'in', qty: 10 }).expect(201);
    await post(`supply/requests/${entry.id}/receive`, { qty: 2 }).expect(200);

    const trial = [
      { key: slices.warehouse, path: 'stock/warehouses', body: { name: 'Второй склад учений' }, status: 201 },
      { key: slices.material, path: 'materials', body: { name: 'Материал учений', article: 'C274-TEST', unit: 'шт' }, status: 201 },
      { key: slices.request, path: 'supply/requests', body: { title: 'Новая заявка для учений', qty: 1, unit: 'шт' }, status: 201 },
      { key: slices.movement, path: `stock/items/${item.id}/move`, body: { type: 'in', qty: 5 }, status: 201 },
      { key: slices.reserve, path: `stock/items/${item.id}/move`, body: { type: 'reserve', qty: 1 }, status: 201 },
      { key: slices.receipt, path: `supply/requests/${req.id}/receive`, body: { qty: 4 }, status: 200 },
      { key: slices.receipt, path: `supply/requests/${entry.id}/rollback-receipt`, body: { confirm: true, reason: 'Учения C274' }, status: 200 },
    ];

    const saved = new Map();
    for (const key of Object.values(slices)) {
      const state = (await setFlag(key, { enabledByDefault: false, isActive: key !== slices.reserve, label: 'Режим учений' })).body;
      saved.set(key, { enabledByDefault: false, isActive: state.isActive, label: state.label, updatedAt: state.updatedAt });
    }
    async function checkDenied() {
      for (const probe of trial) {
        const denied = await post(probe.path, probe.body).expect(409);
        expect(denied.body.message).toContain(probe.key);
      }
    }
    await checkDenied();
    await ctx.app.close();
    await start(true);
    for (const [key, state] of saved) expect((await flag(key)).body).toMatchObject(state);
    await checkDenied();

    for (const key of Object.values(slices)) await setFlag(key, { enabledByDefault: true, isActive: true });
    for (const probe of trial) await post(probe.path, probe.body).expect(probe.status);
    expect((await http().get(`/api/stock/items/${item.id}`).set(auth()).expect(200)).body).toMatchObject({ quantity: 15, reservedQty: 1 });
    expect((await http().get(`/api/supply/requests/${req.id}`).set(auth()).expect(200)).body).toMatchObject({ status: 'received' });
    expect((await http().get(`/api/supply/requests/${entry.id}`).set(auth()).expect(200)).body).toMatchObject({ status: 'requested' });
  });
});
