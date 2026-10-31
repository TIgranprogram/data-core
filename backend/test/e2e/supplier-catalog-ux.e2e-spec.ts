import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** Каталог поставщиков: фото позиции, дерево категорий, сортировка. */
describe('Supplier catalog UX', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  const root = new Types.ObjectId(), child = new Types.ObjectId(), sup = new Types.ObjectId(), photo = new Types.ObjectId();
  const ids: Types.ObjectId[] = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];

  beforeAll(async () => {
    ctx = await createTestApp(); app = ctx.app; token = await loginAsAdmin(app);
    for (const c of ['supplieritems', 'categories', 'photos']) await db().collection(c).deleteMany({});
    await db().collection('categories').insertMany([{ _id: root, name: 'Металл', skuPrefix: 'SCU1', kind: 'material' }, { _id: child, name: 'Трубы', skuPrefix: 'SCU2', kind: 'material', parentId: root }]);
    await db().collection('photos').insertOne({ _id: photo, storageUrl: '/uploads/p.jpg' });
    const base = { supplierId: sup, deletedAt: null, priceHistory: [] };
    await db().collection('supplieritems').insertMany([
      { ...base, _id: ids[0], article: 'A', name: 'Труба', categoryId: child, priceHint: 300, priceDate: new Date('2026-01-01'), photoUrl: 'http://x/p.png' },
      { ...base, _id: ids[1], article: 'B', name: 'Лист', categoryId: root, priceHint: 100, priceDate: new Date('2026-05-01') },
      { ...base, _id: ids[2], article: 'C', name: 'Прочее', priceHint: 200, priceDate: new Date('2026-03-01') },
    ]);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('counts: дерево со счётчиком по поддереву и «Без категории»', async () => {
    const r = (await http().get('/api/supply/catalog/counts').set(auth()).expect(200)).body;
    expect(r.noCategory).toBe(1);
    expect(r.categories.find((c: { id: string }) => c.id === String(root))).toMatchObject({ parentId: null, count: 2, own: 1 });
    expect(r.categories.find((c: { id: string }) => c.id === String(child))).toMatchObject({ parentId: String(root), count: 1 });
  });

  it('фильтр categoryId: с потомками; none — без категории', async () => {
    const q = async (v: string) => (await http().get(`/api/supply/catalog/items?categoryId=${v}`).set(auth()).expect(200)).body.items.map((i: { article: string }) => i.article).sort();
    expect(await q(String(root))).toEqual(['A', 'B']);
    expect(await q(String(child))).toEqual(['A']);
    expect(await q('none')).toEqual(['C']);
  });

  it('сортировка по цене и дате цены', async () => {
    const q = async (s: string) => (await http().get(`/api/supply/catalog/items?${s}`).set(auth()).expect(200)).body.items.map((i: { article: string }) => i.article);
    expect(await q('sort=price')).toEqual(['B', 'C', 'A']);
    expect(await q('sort=price&dir=desc')).toEqual(['A', 'C', 'B']);
    expect(await q('sort=priceDate&dir=desc')).toEqual(['B', 'C', 'A']);
  });

  it('фото: добавить, thumb/photos в ответе, убрать; thumb запасом — photoUrl', async () => {
    const id = String(ids[0]);
    const before = (await http().get('/api/supply/catalog/items?search=Труба').set(auth()).expect(200)).body.items[0];
    expect(before).toMatchObject({ photos: [], thumb: 'http://x/p.png' });
    await http().post(`/api/supply/catalog/items/${id}/photos`).set(auth()).send({ photoId: String(new Types.ObjectId()) }).expect(404);
    const r = await http().post(`/api/supply/catalog/items/${id}/photos`).set(auth()).send({ photoId: String(photo) }).expect(200);
    expect(r.body.photos).toEqual([{ id: String(photo), url: '/uploads/p.jpg', thumb: '/uploads/p.jpg' }]);
    expect(r.body.thumb).toBe('/uploads/p.jpg');
    const d = await http().delete(`/api/supply/catalog/items/${id}/photos/${photo}`).set(auth()).expect(200);
    expect(d.body.photos).toEqual([]);
  });
});
