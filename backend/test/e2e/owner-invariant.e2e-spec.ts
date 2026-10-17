import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { createTestApp, TestContext } from '../setup/test-db';
import {
  TEST_ADMIN_USERNAME,
  authHeader,
  loginAsAdmin,
} from '../setup/admin.fixture';
import { User, UserDocument } from '../../src/modules/user/user.schema';

/**
 * TZ-AUTH-306 — owner invariant e2e.
 *
 * The test bootstrap seeds the admin via AdminSeed and pins it as the single
 * owner via the owner backfill. This spec proves:
 *   - exactly one owner exists, bound to TEST_ADMIN_USERNAME;
 *   - /auth/me exposes isOwner only to the owner and strips the owner-only
 *     admin-roles page for ordinary admins;
 *   - the role editor + permissions matrix are owner-only (403 OWNER_ONLY);
 *   - the owner is invisible to ordinary admins (list + getById + mutate);
 *   - an ordinary admin cannot grant admin power at creation.
 */
describe('Owner invariant (TZ-AUTH-306)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let users: Model<UserDocument>;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    users = app.get<Model<UserDocument>>(getModelToken(User.name));
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('pins exactly one owner to the bootstrap admin username', async () => {
    const owners = await users.find({ isOwner: true }).lean().exec();
    expect(owners).toHaveLength(1);
    expect(owners[0]?.username).toBe(TEST_ADMIN_USERNAME);
  });

  it('reports isOwner: true + admin-roles page to the owner', async () => {
    const { access } = await loginAsAdmin(app);
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set(authHeader(access));
    expect(res.status).toBe(200);
    expect(res.body.isOwner).toBe(true);
    expect(res.body.pages).toContain('admin-roles');
  });

  it('owner can list roles and read the permissions matrix', async () => {
    const { access } = await loginAsAdmin(app);
    const roles = await request(app.getHttpServer())
      .get('/api/admin/roles')
      .set(authHeader(access));
    expect(roles.status).toBe(200);

    const perms = await request(app.getHttpServer())
      .get('/api/admin/permissions')
      .set(authHeader(access));
    expect(perms.status).toBe(200);
    expect(perms.body.sections.length).toBeGreaterThan(0);
  });

  it('ordinary admin has isOwner: false and admin-roles page stripped', async () => {
    const { access: ownerAccess } = await loginAsAdmin(app);

    // Owner creates a second, ordinary admin (server-side, via the model).
    const username = `ordinary-admin-${Date.now()}`;
    await users.create({
      username,
      email: `${username}@kppdf.local`,
      displayName: 'Ordinary admin',
      passwordHash: await bcrypt.hash('ordinary-admin-password', 10),
      role: 'admin',
      permissions: [],
      isActive: true,
    });

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password: 'ordinary-admin-password' })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set(authHeader(login.body.access));
    expect(me.status).toBe(200);
    expect(me.body.isOwner).toBe(false);
    expect(me.body.pages).toContain('admin-users');
    expect(me.body.pages).not.toContain('admin-roles');
    void ownerAccess;
  });

  it('ordinary admin cannot read the role editor or permissions matrix', async () => {
    const username = `ordinary-admin-${Date.now()}`;
    await users.create({
      username,
      email: `${username}@kppdf.local`,
      displayName: 'Ordinary admin',
      passwordHash: await bcrypt.hash('ordinary-admin-password', 10),
      role: 'admin',
      permissions: [],
      isActive: true,
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password: 'ordinary-admin-password' })
      .expect(200);

    const roles = await request(app.getHttpServer())
      .get('/api/admin/roles')
      .set(authHeader(login.body.access));
    expect(roles.status).toBe(403);
    expect(roles.body.code).toBe('OWNER_ONLY');

    const perms = await request(app.getHttpServer())
      .get('/api/admin/permissions')
      .set(authHeader(login.body.access));
    expect(perms.status).toBe(403);
    expect(perms.body.code).toBe('OWNER_ONLY');
  });

  it('ordinary admin cannot see the owner in the user list or by id', async () => {
    const owner = await users.findOne({ isOwner: true }).lean().exec();
    expect(owner).toBeTruthy();

    const username = `ordinary-admin-${Date.now()}`;
    await users.create({
      username,
      email: `${username}@kppdf.local`,
      displayName: 'Ordinary admin',
      passwordHash: await bcrypt.hash('ordinary-admin-password', 10),
      role: 'admin',
      permissions: [],
      isActive: true,
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password: 'ordinary-admin-password' })
      .expect(200);

    const list = await request(app.getHttpServer())
      .get('/api/admin/users?limit=100')
      .set(authHeader(login.body.access));
    expect(list.status).toBe(200);
    const ids = list.body.items.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(String(owner!._id));

    // Direct GET of the owner by id → 404 (not 403, no fingerprinting).
    const byId = await request(app.getHttpServer())
      .get(`/api/admin/users/${String(owner!._id)}`)
      .set(authHeader(login.body.access));
    expect(byId.status).toBe(404);
  });

  it('ordinary admin cannot mutate the owner (404) or grant admin power (403)', async () => {
    const owner = await users.findOne({ isOwner: true }).lean().exec();
    const username = `ordinary-admin-${Date.now()}`;
    await users.create({
      username,
      email: `${username}@kppdf.local`,
      displayName: 'Ordinary admin',
      passwordHash: await bcrypt.hash('ordinary-admin-password', 10),
      role: 'admin',
      permissions: [],
      isActive: true,
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password: 'ordinary-admin-password' })
      .expect(200);

    // Mutating the owner → 404 (hidden).
    const patch = await request(app.getHttpServer())
      .patch(`/api/admin/users/${String(owner!._id)}`)
      .set(authHeader(login.body.access))
      .send({ displayName: 'Hijacked' });
    expect(patch.status).toBe(404);

    // Creating an admin account → 403 OWNER_ONLY.
    const createAdmin = await request(app.getHttpServer())
      .post('/api/admin/users')
      .set(authHeader(login.body.access))
      .send({
        username: `escalation-${Date.now()}`,
        password: 'escalation-password',
        role: 'admin',
      });
    expect(createAdmin.status).toBe(403);
    expect(createAdmin.body.code).toBe('OWNER_ONLY');
  });

  it('owner password login remains the break-glass entry', async () => {
    const { access } = await loginAsAdmin(app);
    expect(access).toBeTruthy();
  });
});
