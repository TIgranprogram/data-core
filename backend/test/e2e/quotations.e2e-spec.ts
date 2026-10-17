import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext, clearCollections } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

describe('Quotations (e2e)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: string;
  let counterpartyId: string;
  let orgId: string;
  let productId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const auth = await loginAsAdmin(app);
    token = auth.access;
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  beforeEach(async () => {
    await clearCollections(ctx!.connection, [
      'quotations',
      'counterparties',
      'organizations',
      'products',
      'categories',
    ]);
    // Setup minimal fixtures
    const cp = await request(app.getHttpServer())
      .post('/api/counterparties')
      .set(authHeader(token))
      .send({ name: 'Test CP', roles: ['customer'], inn: '7710000015' });
    counterpartyId = cp.body._id;
    const org = await request(app.getHttpServer())
      .post('/api/organizations')
      .set(authHeader(token))
      .send({ name: 'Test Org', inn: '9876543210' });
    orgId = org.body._id;
    const prod = await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(token))
      .send({
        name: 'Test Product',
        sku: 'TEST-1',
        kind: 'good',
        unit: 'шт',
        listPrice: 100,
      });
    productId = prod.body._id;
  });

  it('POST /quotations — creates with snapshot fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/quotations')
      .set(authHeader(token))
      .send({
        organizationId: orgId,
        counterpartyId,
        items: [{ productId, quantity: 5, unitPrice: 100 }],
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.total).toBe(500);
    expect(res.body.items[0].total).toBe(500);
    expect(res.body.items[0].unitPrice).toBe(100);
  });

  it('POST /quotations — draft may omit counterparty and persists template snapshot', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/quotations')
      .set(authHeader(token))
      .send({
        organizationId: orgId,
        status: 'draft',
        orgMarkupPercent: 12,
        templateId: new (require('mongoose').Types.ObjectId)().toString(),
        templateSnapshot: { templateId: 'tpl-1', html: '<table></table>' },
        items: [{ productId, quantity: 2, unitPrice: 100 }],
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.counterpartyId).toBeUndefined();
    expect(res.body.templateSnapshot.html).toBe('<table></table>');
    expect(res.body.orgMarkupPercent).toBe(12);
  });

  it('POST /quotations/:id/duplicate — creates new Quotation', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/quotations')
      .set(authHeader(token))
      .send({
        organizationId: orgId,
        counterpartyId,
        items: [{ productId, quantity: 1, unitPrice: 50 }],
      });
    const dup = await request(app.getHttpServer())
      .post(`/api/quotations/${create.body._id}/duplicate`)
      .set(authHeader(token));
    expect([200, 201]).toContain(dup.status);
    expect(dup.body._id).not.toBe(create.body._id);
    expect(dup.body.items.length).toBe(create.body.items.length);
  });

  it('Snapshot integrity — product price change does not affect old quotation', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/quotations')
      .set(authHeader(token))
      .send({
        organizationId: orgId,
        counterpartyId,
        items: [{ productId, quantity: 1, unitPrice: 100 }],
      });
    const oldSnapshotPrice = create.body.items[0].unitPrice;
    // Update product price
    await request(app.getHttpServer())
      .patch(`/api/products/${productId}`)
      .set(authHeader(token))
      .send({ listPrice: 999 });
    // Re-fetch quotation
    const refetch = await request(app.getHttpServer())
      .get(`/api/quotations/${create.body._id}`)
      .set(authHeader(token));
    expect(refetch.body.items[0].unitPrice).toBe(oldSnapshotPrice);
  });

  it('DELETE /quotations/:id — soft-deletes and hides the quotation from list/GET', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/quotations')
      .set(authHeader(token))
      .send({
        organizationId: orgId,
        counterpartyId,
        items: [{ productId, quantity: 1, unitPrice: 100 }],
      });

    const removed = await request(app.getHttpServer())
      .delete(`/api/quotations/${create.body._id}`)
      .set(authHeader(token));
    expect([200, 204]).toContain(removed.status);

    const list = await request(app.getHttpServer())
      .get('/api/quotations')
      .set(authHeader(token));
    expect(
      list.body.some((row: { _id: string }) => row._id === create.body._id),
    ).toBe(false);

    const get = await request(app.getHttpServer())
      .get(`/api/quotations/${create.body._id}`)
      .set(authHeader(token));
    expect(get.status).toBe(404);
  });

  it('create → soft-delete → create twice keeps quotation creation healthy', async () => {
    const create = () =>
      request(app.getHttpServer())
        .post('/api/quotations')
        .set(authHeader(token))
        .send({
          organizationId: orgId,
          counterpartyId,
          items: [{ productId, quantity: 1, unitPrice: 100 }],
        });

    const first = await create();
    expect([200, 201]).toContain(first.status);
    await request(app.getHttpServer())
      .delete(`/api/quotations/${first.body._id}`)
      .set(authHeader(token))
      .expect((res) => expect([200, 204]).toContain(res.status));

    const second = await create();
    const third = await create();
    expect([200, 201]).toContain(second.status);
    expect([200, 201]).toContain(third.status);
    expect(
      new Set([first.body.number, second.body.number, third.body.number]).size,
    ).toBe(3);

    const list = await request(app.getHttpServer())
      .get('/api/quotations')
      .set(authHeader(token));
    expect(list.body.map((row: { _id: string }) => row._id)).toEqual(
      expect.arrayContaining([second.body._id, third.body._id]),
    );
    expect(
      list.body.some((row: { _id: string }) => row._id === first.body._id),
    ).toBe(false);
  });

  it('POST /quotations/:id/convert-to-contract — creates Contract', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/quotations')
      .set(authHeader(token))
      .send({
        organizationId: orgId,
        counterpartyId,
        items: [{ productId, quantity: 1, unitPrice: 100 }],
      });
    const convert = await request(app.getHttpServer())
      .post(`/api/quotations/${create.body._id}/convert-to-contract`)
      .set(authHeader(token))
      .send({});
    expect([200, 201]).toContain(convert.status);
    expect(convert.body.contractId).toBeDefined();
  });
});
