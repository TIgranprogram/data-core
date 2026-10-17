import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext, clearCollections } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

describe('Contracts (e2e)', () => {
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
      'contracts', 'counterparties', 'organizations', 'products',
    ]);
    // Seed prerequisite entities
    const cp = await request(app.getHttpServer())
      .post('/api/counterparties')
      .set(authHeader(token))
      .send({ name: 'Contract CP', roles: ['customer'], inn: '7710000015' });
    counterpartyId = cp.body._id;

    const org = await request(app.getHttpServer())
      .post('/api/organizations')
      .set(authHeader(token))
      .send({ name: 'Contract Org', inn: '1234567894' });
    orgId = org.body._id;

    const prod = await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(token))
      .send({ name: 'Contract Product', kind: 'good', unit: 'шт', listPrice: 200 });
    productId = prod.body._id;
  });

  describe('POST /contracts', () => {
    it('admin creates a contract with items', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/contracts')
        .set(authHeader(token))
        .send({
          organizationId: orgId,
          customerId: counterpartyId,
          items: [{ productId, quantity: 10, unitPrice: 200 }],
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body._id).toBeDefined();
      expect(res.body.items.length).toBe(1);
    });
  });

  describe('GET /contracts', () => {
    it('returns list with counterpartyId filter', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/contracts')
        .set(authHeader(token))
        .send({
          organizationId: orgId,
          customerId: counterpartyId,
          items: [{ productId, quantity: 5, unitPrice: 200 }],
        });
      expect([200, 201]).toContain(created.status);

      const res = await request(app.getHttpServer())
        .get(`/api/contracts?counterpartyId=${counterpartyId}`)
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('returns list with status filter', async () => {
      await request(app.getHttpServer())
        .post('/api/contracts')
        .set(authHeader(token))
        .send({
          organizationId: orgId,
          customerId: counterpartyId,
          status: 'draft',
          items: [{ productId, quantity: 3, unitPrice: 200 }],
        });

      const res = await request(app.getHttpServer())
        .get('/api/contracts?status=draft')
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });
  });
});
