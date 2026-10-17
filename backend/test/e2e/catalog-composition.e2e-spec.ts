import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, TestContext } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

describe('Catalog composition (TZ-CATALOG-302)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let token: string;
  let productId: string;
  let moduleId: string;
  let nestedModuleId: string;
  let rawMaterialId: string;
  let partMaterialId: string;
  let productLineId: string;
  let moduleLineId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = (await loginAsAdmin(app)).access;
    const auth = authHeader(token);

    productId = (await request(app.getHttpServer())
      .post('/api/products')
      .set(auth)
      .send({ name: 'TZ302 Composition Product', kind: 'good', unit: 'шт' })
      .expect(201)).body._id;

    moduleId = (await request(app.getHttpServer())
      .post('/api/modules')
      .set(auth)
      .send({ name: 'TZ302 Composition Module', workTypes: [] })
      .expect(201)).body._id;

    nestedModuleId = (await request(app.getHttpServer())
      .post('/api/modules')
      .set(auth)
      .send({ name: 'TZ302 Nested Module', workTypes: [] })
      .expect(201)).body._id;

    rawMaterialId = (await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth)
      .send({ name: 'TZ302 Raw Material', unit: 'кг', materialKind: 'raw' })
      .expect(201)).body._id;

    partMaterialId = (await request(app.getHttpServer())
      .post('/api/materials')
      .set(auth)
      .send({ name: 'TZ302 Part Material', unit: 'шт', materialKind: 'part' })
      .expect(201)).body._id;
  });

  afterAll(async () => {
    const auth = authHeader(token);
    for (const [path, id] of [
      ['/api/products', productId],
      ['/api/modules', moduleId],
      ['/api/modules', nestedModuleId],
      ['/api/materials', rawMaterialId],
      ['/api/materials', partMaterialId],
    ] as const) {
      if (id) await request(app.getHttpServer()).delete(`${path}/${id}`).set(auth);
    }
    await ctx.cleanup();
  });

  it('adds and reads a Product module line with generated _id', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/products/${productId}/composition`)
      .set(authHeader(token))
      .send({ lineType: 'module', refId: moduleId, quantity: 2 })
      .expect(201);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]._id).toMatch(/^[a-f0-9]{24}$/);
    expect(response.body[0].quantity).toBe(2);
    productLineId = response.body[0]._id;
  });

  it('deduplicates the same Product line by incrementing quantity', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/products/${productId}/composition`)
      .set(authHeader(token))
      .send({ lineType: 'module', refId: moduleId, quantity: 3 })
      .expect(201);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].quantity).toBe(5);
  });

  it('reads legacy productModuleIds when composition is empty without writing composition', async () => {
    const legacyProductId = (await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(token))
      .send({ name: 'TZ302 Legacy Product', kind: 'good', unit: 'шт' })
      .expect(201)).body._id;
    const legacyModuleId = (await request(app.getHttpServer())
      .post('/api/modules')
      .set(authHeader(token))
      .send({ name: 'TZ302 Legacy Module', workTypes: [] })
      .expect(201)).body._id;
    try {
      // TZ-CATALOG-304: API attach is gone (410). Seed legacy field directly for dual-read coverage.
      await ctx.connection.collection('products').updateOne(
        { _id: new Types.ObjectId(legacyProductId) },
        { $set: { productModuleIds: [new Types.ObjectId(legacyModuleId)], composition: [] } },
      );

      const composition = await request(app.getHttpServer())
        .get(`/api/products/${legacyProductId}/composition`)
        .set(authHeader(token))
        .expect(200);
      expect(composition.body).toEqual([
        expect.objectContaining({ lineType: 'module', refId: legacyModuleId, quantity: 1 }),
      ]);

      const product = await request(app.getHttpServer())
        .get(`/api/products/${legacyProductId}`)
        .set(authHeader(token))
        .expect(200);
      expect(product.body.composition ?? []).toHaveLength(0);

      await request(app.getHttpServer())
        .post(`/api/products/${legacyProductId}/modules`)
        .set(authHeader(token))
        .send({ moduleId: legacyModuleId })
        .expect(410);
    } finally {
      await request(app.getHttpServer()).delete(`/api/products/${legacyProductId}`).set(authHeader(token));
      await request(app.getHttpServer()).delete(`/api/modules/${legacyModuleId}`).set(authHeader(token));
    }
  });

  it('rejects raw material on Product and accepts a non-raw material', async () => {
    await request(app.getHttpServer())
      .post(`/api/products/${productId}/composition`)
      .set(authHeader(token))
      .send({ lineType: 'material', refId: rawMaterialId, quantity: 1 })
      .expect(400);

    const accepted = await request(app.getHttpServer())
      .post(`/api/products/${productId}/composition`)
      .set(authHeader(token))
      .send({ lineType: 'material', refId: partMaterialId, quantity: 1 })
      .expect(201);
    expect(accepted.body.some((line: { refId: string }) => line.refId === partMaterialId)).toBe(true);
  });

  it('updates and deletes a Product composition line', async () => {
    const updated = await request(app.getHttpServer())
      .patch(`/api/products/${productId}/composition/${productLineId}`)
      .set(authHeader(token))
      .send({ quantity: 7 })
      .expect(200);
    expect(updated.body.find((line: { _id: string }) => line._id === productLineId).quantity).toBe(7);

    await request(app.getHttpServer())
      .delete(`/api/products/${productId}/composition/${productLineId}`)
      .set(authHeader(token))
      .expect(204);
  });

  it('supports Module composition CRUD and dual-read does not write', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/modules/${moduleId}/composition`)
      .set(authHeader(token))
      .send({ lineType: 'module', refId: nestedModuleId, quantity: 2 })
      .expect(201);
    expect(created.body).toHaveLength(1);
    moduleLineId = created.body[0]._id;

    const got = await request(app.getHttpServer())
      .get(`/api/modules/${moduleId}/composition`)
      .set(authHeader(token))
      .expect(200);
    expect(got.body[0]._id).toBe(moduleLineId);

    await request(app.getHttpServer())
      .patch(`/api/modules/${moduleId}/composition/${moduleLineId}`)
      .set(authHeader(token))
      .send({ quantity: 4 })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/modules/${moduleId}/composition/${moduleLineId}`)
      .set(authHeader(token))
      .expect(204);
  });
});
