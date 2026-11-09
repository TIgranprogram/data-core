import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import type { Connection } from 'mongoose';
import { uploadsRoot } from '../../src/common/uploads/safe-path';
import type { PdmTreeDto } from '../../src/modules/pdm-import/dto/pdm-tree.dto';
import { DXF_BUFFER, DXF_SHA, miniTree } from '../../src/modules/pdm-import/pdm-tree.testkit';
import { createTestApp, TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/test-auth';

/** Загрузка из PDM (C057): предпросмотр → применение → повтор → второе изделие → восстановление → 409 → права → файлы. */
describe('PDM import (C057)', () => {
  let ctx: TestContext, app: INestApplication, db: Connection, admin: string, manager: string;
  const http = () => request(app.getHttpServer());
  const tree = (): PdmTreeDto => JSON.parse(JSON.stringify(miniTree()));
  const col = (name: string) => db.collection(name);
  const preview = (t: unknown, token = admin) => http().post('/api/pdm-import/preview').set(authHeader(token)).send(t as object);
  const apply = (body: unknown, token = admin) => http().post('/api/pdm-import/apply').set(authHeader(token)).send(body as object);
  let firstPlan = '';

  beforeAll(async () => {
    ctx = await createTestApp(); app = ctx.app; db = ctx.connection;
    admin = (await loginAsAdmin(app)).access;
    const username = `pdm-mgr-${Date.now()}`;
    await http().post('/api/admin/users').set(authHeader(admin)).send({ username, password: 'role-pass-123', role: 'manager' }).expect(201);
    manager = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
  });
  afterAll(async () => {
    rmSync(join(uploadsRoot(), 'pdm', '0000.1005.0001'), { recursive: true, force: true });
    await ctx?.cleanup();
  });

  it('не администратор — 403 на все три маршрута', async () => {
    await preview(tree(), manager).expect(403);
    await apply({ planId: '507f1f77bcf86cd799439011' }, manager).expect(403);
    await http().post('/api/pdm-import/files').set(authHeader(manager)).expect(403);
  });

  it('«../» в обозначении — 400', async () => {
    const t = tree(); t.items[2].designation = '../etc/passwd';
    await preview(t).expect(400);
    const dots = tree(); dots.items[3].designation = 'a..b';
    await preview(dots).expect(400);
  });

  it('неверный формат дерева — 400 по-русски', async () => {
    const res = await preview({ ...tree(), schema: 'pdm-tree/9' }).expect(400);
    expect(JSON.stringify(res.body)).toContain('pdm-tree/1');
  });

  it('предпросмотр на пустой базе: всё «создать», номенклатура не тронута', async () => {
    const res = await preview(tree()).expect(201);
    expect(res.body.summary).toEqual({ create: 8, link: 0, suggest: 0, conflict: 0, same: 0 });
    expect(res.body.blockers).toEqual([]);
    expect(res.body.needFiles).toEqual([DXF_SHA]);
    expect(res.body.sortaments).toHaveLength(2);
    expect(await col('materials').countDocuments({ article: '0000.1005.0001' })).toBe(0);
    firstPlan = res.body.planId;
  });

  it('применение: детали, сортаменты, модуль и изделие записаны', async () => {
    const res = await apply({ planId: firstPlan }).expect(201);
    expect(res.body).toMatchObject({ importId: firstPlan, created: 8, linked: 0, updated: 0, skipped: 0, needFiles: [DXF_SHA] });

    const part = await col('materials').findOne({ article: '0000.1005.0001' });
    expect(part).toMatchObject({ name: '0000.1005.0001', materialKind: 'part', needsName: true, weightKg: 0.27, dimSource: 'dxf', colors: ['8017'] });
    expect(part!.sku).toBeUndefined();
    expect(part!.composition).toHaveLength(1);
    expect(part!.composition[0]).toMatchObject({ lineType: 'material', quantity: 0.020248, unit: 'м²' });
    const sheet = await col('materials').findOne({ _id: part!.composition[0].refId });
    expect(sheet).toMatchObject({ isProfile: true, materialKind: 'raw', unit: 'м²', scrapFactor: 1 });

    const fastener = await col('materials').findOne({ article: 'SHP08.D125' });
    expect(fastener).toMatchObject({ materialKind: 'fastener', pdmCode: 'SHP08.D125', pdmAliases: ['ШП08.D125'] });
    const module = await col('productmodules').findOne({ article: '0000.1005.0000' });
    expect(module!.composition).toHaveLength(3);
    const product = await col('products').findOne({ sku: '6104.0000.0000' });
    expect(product).toMatchObject({ name: '6104.0000.0000', needsName: true });
    expect(product!.composition.map((l: { lineType: string }) => l.lineType)).toEqual(['module', 'material', 'material', 'material']);
    // в изделии нет сырья
    const rawInProduct = await col('materials').countDocuments({ _id: { $in: product!.composition.map((l: { refId: unknown }) => l.refId) }, materialKind: 'raw' });
    expect(rawInProduct).toBe(0);
  });

  it('повтор apply того же плана — прежний итог, ничего нового', async () => {
    const before = await col('materials').countDocuments();
    const res = await apply({ planId: firstPlan }).expect(201);
    expect(res.body).toMatchObject({ importId: firstPlan, created: 8 });
    expect(await col('materials').countDocuments()).toBe(before);
    expect(await col('products').countDocuments({ sku: '6104.0000.0000' })).toBe(1);
  });

  it('то же дерево ещё раз: всё «одинаково», загрузка ничего не создаёт и не меняет', async () => {
    const pv = await preview(tree()).expect(201);
    expect(pv.body.summary).toEqual({ create: 0, link: 0, suggest: 0, conflict: 0, same: 8 });
    const res = await apply({ planId: pv.body.planId }).expect(201);
    expect(res.body).toMatchObject({ created: 0, updated: 0, skipped: 8 });
    expect(await col('materials').countDocuments({ article: '0000.0000.2002' })).toBe(1);
  });

  it('apply по дереву (как в CONTRACT): план находится по хэшу', async () => {
    await preview(tree()).expect(201);
    const res = await apply({ tree: tree() }).expect(201);
    expect(res.body.created).toBe(0);
  });

  it('второе изделие с той же каталожной деталью — ссылка на ту же запись', async () => {
    const part = tree().items.find((i) => i.designation === '0000.0000.2002')!;
    const second: PdmTreeDto = {
      schema: 'pdm-tree/1', root: '6105.0000.0000',
      items: [{ designation: '6105.0000.0000', kind: 'product', file: { id: 101, version: 1, state: 'В разработке' } }, part],
      bom: [{ parent: '6105.0000.0000', child: '0000.0000.2002', qty: 3 }],
    };
    const pv = await preview(second).expect(201);
    expect(pv.body.items.find((r: { designation: string }) => r.designation === '0000.0000.2002')).toMatchObject({ action: 'same', by: 'article' });
    const res = await apply({ planId: pv.body.planId }).expect(201);
    expect(res.body).toMatchObject({ created: 1, linked: 1 });
    const catalogPart = await col('materials').findOne({ article: '0000.0000.2002' });
    const product = await col('products').findOne({ sku: '6105.0000.0000' });
    expect(String(product!.composition[0].refId)).toBe(String(catalogPart!._id));
    expect(product!.composition[0].quantity).toBe(3);
    expect(await col('materials').countDocuments({ article: '0000.0000.2002' })).toBe(1);
  });

  it('удалённая деталь восстанавливается', async () => {
    await col('materials').updateOne({ article: '0000.1005.0002' }, { $set: { deletedAt: new Date() } });
    const pv = await preview(tree()).expect(201);
    expect(pv.body.items.find((r: { designation: string }) => r.designation === '0000.1005.0002')).toMatchObject({ action: 'link', deleted: true });
    const res = await apply({ planId: pv.body.planId }).expect(201);
    expect(res.body.updated).toBe(1);
    expect((await col('materials').findOne({ article: '0000.1005.0002' }))!.deletedAt).toBeNull();
    expect(await col('materials').countDocuments({ article: '0000.1005.0002' })).toBe(1);
  });

  it('расхождение «сайт | PDM»: без решения вес сайта остаётся, с решением берётся PDM', async () => {
    await col('materials').updateOne({ article: '0000.0000.2002' }, { $set: { weightKg: 9 } });
    const pv = await preview(tree()).expect(201);
    expect(pv.body.items.find((r: { designation: string }) => r.designation === '0000.0000.2002')).toMatchObject({ action: 'conflict', fields: [{ field: 'weightKg', site: 9, pdm: 3.5 }] });
    await apply({ planId: pv.body.planId }).expect(201);
    expect((await col('materials').findOne({ article: '0000.0000.2002' }))!.weightKg).toBe(9);
    const pv2 = await preview(tree()).expect(201);
    await apply({ planId: pv2.body.planId, decisions: { '0000.0000.2002': { action: 'link', fields: { weightKg: 'pdm' } } } }).expect(201);
    expect((await col('materials').findOne({ article: '0000.0000.2002' }))!.weightKg).toBe(3.5);
  });

  it('запись изменили после предпросмотра — 409', async () => {
    const pv = await preview(tree()).expect(201);
    await col('productmodules').updateOne({ article: '0000.1005.0000' }, { $set: { notes: 'правка', updatedAt: new Date(Date.now() + 5000) } });
    const res = await apply({ planId: pv.body.planId }).expect(409);
    expect(JSON.stringify(res.body)).toContain('Данные на сайте изменились');
  });

  it('неизвестный план — 404, плохое решение — 400', async () => {
    await apply({ planId: '507f1f77bcf86cd799439011' }).expect(404);
    const pv = await preview(tree()).expect(201);
    await apply({ planId: pv.body.planId, decisions: { 'PI.0003': { action: 'взорвать' } } }).expect(400);
  });

  it('файлы: сохраняются под владельцем, повтор — stored:false, чужой файл — 400', async () => {
    const send = (over: Record<string, string> = {}) => {
      const fields = { importId: firstPlan, designation: '0000.1005.0001', type: 'dxf', name: '0000.1005.0001.DXF', version: '2', sha256: DXF_SHA, ...over };
      let r = http().post('/api/pdm-import/files').set(authHeader(admin));
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      return r.attach('file', DXF_BUFFER, '0000.1005.0001.DXF');
    };
    const first = await send().expect(201);
    expect(first.body.stored).toBe(true);
    expect((await send().expect(201)).body.stored).toBe(false);
    await send({ designation: '0000.1005.0002' }).expect(400);
    await send({ sha256: 'f'.repeat(64) }).expect(400);

    const part = await col('materials').findOne({ article: '0000.1005.0001' });
    const list = await http().get(`/api/pdm-files?ownerKind=material&ownerId=${part!._id}`).set(authHeader(admin)).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ docKind: 'dxf', pdmVersion: 2, isCurrent: true });
    const preview2 = await preview(tree()).expect(201);
    expect(preview2.body.needFiles).toEqual([]);
  });
});
