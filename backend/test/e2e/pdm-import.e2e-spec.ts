import request from 'supertest';
import sharp from 'sharp';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
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

  it('превью: фото под владельцем и главное; повтор — stored:false; фото менеджера не перебивается; не из дерева — 400', async () => {
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#336699' } }).png().toBuffer();
    const sha = createHash('sha256').update(png).digest('hex');
    const send = (buf: Buffer, designation = '0000.1005.0001', hash = createHash('sha256').update(buf).digest('hex')) => {
      let r = http().post('/api/pdm-import/preview-image').set(authHeader(admin));
      for (const [k, v] of Object.entries({ importId: firstPlan, designation, sha256: hash })) r = r.field(k, v);
      return r.attach('file', buf, 'p.png');
    };
    const first = await send(png).expect(201);
    expect(first.body).toMatchObject({ stored: true, main: true });
    const part = await col('materials').findOne({ article: '0000.1005.0001' });
    expect(String(part!.mainPhotoId)).toBe(first.body.photoId);
    expect(await col('photos').findOne({ _id: part!.mainPhotoId })).toMatchObject({ source: 'pdm', sha256: sha });
    expect((await send(png).expect(201)).body).toMatchObject({ stored: false, photoId: first.body.photoId });
    // менеджер ставит своё главное фото — следующее превью из PDM его не перебивает
    const mine = new Types.ObjectId();
    await col('photos').insertOne({ _id: mine, storageUrl: '/uploads/mine.png', variant: 'original', deletedAt: null });
    await col('materials').updateOne({ _id: part!._id }, { $set: { mainPhotoId: mine } });
    const png2 = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#aa3333' } }).png().toBuffer();
    expect((await send(png2).expect(201)).body).toMatchObject({ stored: true, main: false });
    expect(String((await col('materials').findOne({ _id: part!._id }))!.mainPhotoId)).toBe(String(mine));
    await send(png, '9999.0000.0000').expect(400);
    await send(Buffer.from('not an image'), '0000.1005.0001', 'a'.repeat(64)).expect(400);
  });

  describe('«Что купить» и приложение', () => {
    let productId = '';
    const needs = (qty?: string, token = admin) => http().get(`/api/products/${productId}/purchase-needs${qty ? `?qty=${qty}` : ''}`).set(authHeader(token));
    const byName = (items: Array<{ name: string; note?: string }>, re: RegExp) => items.find((i) => re.test(i.name))!;

    beforeAll(async () => { productId = String((await col('products').findOne({ sku: '6104.0000.0000' }))!._id); });

    it('лист 4 мм и фанера 21 — в м² (нет формата), шайба — в штуках; детали без заготовки нет', async () => {
      const res = await needs().expect(200);
      expect(res.body.missingBlank).toEqual([]);
      const sheet = byName(res.body.items, /Лист/), ply = byName(res.body.items, /Фанера/), washer = res.body.items.find((i: { name: string }) => /SHP08/.test(i.name));
      expect(sheet).toMatchObject({ unit: 'м²', need: 0.060744, have: 0, buy: 0.060744, buyUnit: 'м²' });
      expect(sheet.note).toContain('Нет формата');
      expect(ply).toMatchObject({ unit: 'м²', need: 0.48, buy: 0.48 });
      expect(washer).toMatchObject({ kind: 'fastener', unit: 'шт', need: 8, have: 0, buy: 8 });
    });

    it('есть формат на складе: остаток вычитается, покупка — целыми листами; qty умножает', async () => {
      const profile = await col('materials').findOne({ isProfile: true, assortment: /^Лист/ });
      await col('materials').insertOne({
        name: 'Лист 4 мм 1250×2500', article: 'T-LIST-4', unit: 'шт', materialKind: 'raw', profileId: profile!._id, isDefaultFormat: true, stockQty: 1,
        dimensions: [{ type: 'length', value: 2500, isImmutable: false }, { type: 'width', value: 1250, isImmutable: false }], deletedAt: null,
      });
      const one = byName((await needs().expect(200)).body.items, /Лист/);
      expect(one).toMatchObject({ have: 3.125, buy: 0, buyUnit: 'шт', format: { name: 'Лист 4 мм 1250×2500' } });
      const many = byName((await needs('100').expect(200)).body.items, /Лист/);
      expect(many).toMatchObject({ need: 6.0744, have: 3.125, buy: 1, buyUnit: 'шт' });
      const lots = byName((await needs('200').expect(200)).body.items, /Лист/);
      expect(lots).toMatchObject({ need: 12.1488, buy: 3 });
    });

    it('плохое количество — 400, нет изделия — 404, без входа — 401', async () => {
      await needs('0').expect(400);
      await needs('abc').expect(400);
      await http().get('/api/products/507f1f77bcf86cd799439011/purchase-needs').set(authHeader(admin)).expect(404);
      await http().get(`/api/products/${productId}/purchase-needs`).expect(401);
    });

    it('приложение: нет файла — 404 по-русски, не админ — 403, после выкладки — сведения и файл', async () => {
      const dir = join(uploadsRoot(), 'apps');
      rmSync(dir, { recursive: true, force: true });
      const none = await http().get('/api/apps/pdm-loader').set(authHeader(admin)).expect(404);
      expect(JSON.stringify(none.body)).toContain('Приложение ещё не выложено');
      await http().get('/api/apps/pdm-loader').set(authHeader(manager)).expect(403);
      await http().get('/api/apps/pdm-loader/download').set(authHeader(manager)).expect(403);
      const vdir = join(dir, 'pdm-loader', '1.2.0');
      mkdirSync(vdir, { recursive: true });
      writeFileSync(join(vdir, 'DataCore.PdmLoader.exe'), 'MZtest');
      try {
        const info = await http().get('/api/apps/pdm-loader').set(authHeader(admin)).expect(200);
        expect(info.body).toMatchObject({ version: '1.2.0', size: 6 });
        const file = await http().get('/api/apps/pdm-loader/download').set(authHeader(admin)).buffer(true).expect(200);
        expect(file.headers['content-disposition']).toContain('attachment');
        expect(file.headers['x-content-type-options']).toBe('nosniff');
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  });
});
