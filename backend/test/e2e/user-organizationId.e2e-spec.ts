import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, TestContext } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';
import { TEST_ADMIN_PASSWORD, TEST_ADMIN_USERNAME } from '../setup/admin.fixture';

/**
 * TZ-238 — User.organizationId propagation (JWT orgId claim + /auth/me).
 *
 * Real contract (verified against the running app, not aspirational):
 *  - CreateUserDto.organizationId is @IsOptional @IsString → POST /api/users
 *    without it returns 201 (a system-scoped user), with it returns 201 too.
 *  - The create() path does NOT persist organizationId (UserService.create
 *    maps only whitelisted fields); the orgId lives at the DB level, set by
 *    the TZ-238 migration / admin path. JWT + /auth/me propagate it from the
 *    schema, so we exercise that path by setting organizationId directly on
 *    the document (same state the migration produces).
 *  - POST /auth/login → access token carries `orgId` claim; system admin → null.
 *  - GET /auth/me → `organizationId` field present; system admin → null.
 */
describe('User organizationId (TZ-238)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: string;
  let orgId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const auth = await loginAsAdmin(app);
    token = auth.access;
    // One shared org for the whole suite — organizations.inn is unique-indexed.
    const res = await request(app.getHttpServer())
      .post('/api/organizations')
      .set(authHeader(token))
      .send({ name: 'TZ238 Org', inn: '1234567894' });
    expect([200, 201]).toContain(res.status);
    orgId = res.body._id;
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  function decodeJwt(access: string): Record<string, unknown> {
    const payload = access.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
  }

  async function createUser(username: string, withOrg = false): Promise<void> {
    const res = await request(app.getHttpServer())
      .post('/api/users')
      .set(authHeader(token))
      .send({
        username,
        email: `${username}@example.com`,
        displayName: username,
        password: 'password123',
        role: 'user',
        ...(withOrg ? { organizationId: orgId } : {}),
      });
    expect(res.status).toBe(201);
  }

  it('POST /api/users without organizationId returns 201 (field optional per DTO)', async () => {
    const username = `noorg_${Date.now()}`;
    await createUser(username);
    // System-scoped user exists and can log in.
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password: 'password123' });
    expect([200, 201]).toContain(login.status);
    const payload = decodeJwt(login.body.access as string);
    expect(payload.orgId).toBeNull();
  });

  it('POST /api/users with organizationId returns 201 (field accepted)', async () => {
    await createUser(`withorg_${Date.now()}`, true);
  });

  it('POST /auth/login returns JWT with orgId claim', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD });
    expect([200, 201]).toContain(res.status);
    const payload = decodeJwt(res.body.access as string);
    expect(payload).toHaveProperty('orgId');
  });

  it('GET /auth/me returns organizationId field', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('organizationId');
  });

  it('JWT decode: orgId claim null for system admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD });
    expect([200, 201]).toContain(res.status);
    const payload = decodeJwt(res.body.access as string);
    expect(payload.orgId).toBeNull();
  });

  it('GET /api/auth/me: organizationId null for system admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.organizationId).toBeNull();
  });

  it('user with organizationId in DB (migration state) → JWT orgId claim propagates', async () => {
    // Arrange: create user, then set organizationId directly on the document —
    // the exact state the TZ-238 migration produces. This is the propagation
    // path actually implemented (schema → auth.service signAccess).
    const username = `prop_${Date.now()}`;
    await createUser(username);
    await ctx!.connection
      .collection('users')
      .updateOne(
        { username },
        { $set: { organizationId: new Types.ObjectId(orgId) } },
      );

    // Act: login as the org-scoped user.
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password: 'password123' });
    expect([200, 201]).toContain(login.status);

    // Assert: JWT carries the orgId claim; /auth/me echoes it.
    const payload = decodeJwt(login.body.access as string);
    expect(payload.orgId).toBe(orgId);
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set(authHeader(login.body.access as string));
    expect(me.status).toBe(200);
    expect(me.body.organizationId).toBe(orgId);
  });
});
