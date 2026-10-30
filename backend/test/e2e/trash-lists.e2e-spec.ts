import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** Экран «Корзина» (pwa/sections/trash.js): каждый его список принимает deleted=1 и сортировку по дате удаления. */
describe('Корзина: списки удалённого', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it.each(['/supply/requests', '/stock/items', '/salesorders', '/incomes', '/partners', '/showcase', '/passports', '/offers', '/design-tasks', '/work-tasks'])('%s', async (path) => {
    const r = await request(app.getHttpServer()).get(`/api${path}`).query({ deleted: 1, sort: '-deletedAt', limit: 100 }).set(authHeader(token.access)).expect(200);
    expect(Array.isArray(r.body.items)).toBe(true);
  });
});
