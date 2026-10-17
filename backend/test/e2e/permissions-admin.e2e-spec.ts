import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { createTestApp, TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { User, UserDocument } from '../../src/modules/user/user.schema';

describe('Permissions admin catalog (TZ-275)', () => {
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

  it('rejects role:read-only users from the full permissions catalog', async () => {
    const username = `tz275-read-only-${Date.now()}`;
    await users.create({
      username,
      email: `${username}@kppdf.local`,
      displayName: 'TZ-275 read-only user',
      passwordHash: await bcrypt.hash('tz275-password', 10),
      role: 'manager',
      permissions: ['role:read'],
      isActive: true,
    });

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password: 'tz275-password' })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get('/api/admin/permissions')
      .set(authHeader(login.body.access));

    expect(response.status).toBe(403);
    // APP_GUARD order is Jwt → Permissions → Roles; this message proves
    // the denial came from the missing role:write capability, not only from
    // the legacy @Roles('admin') guard.
    expect(response.body.message).toContain('Required permission');
  });

  it('allows an admin and records the catalog access audit action', async () => {
    const { access, user } = await loginAsAdmin(app);

    const response = await request(app.getHttpServer())
      .get('/api/admin/permissions')
      .set(authHeader(access));

    expect(response.status).toBe(200);
    expect(response.body.sections.length).toBeGreaterThan(0);

    const auditLogs = ctx!.connection.collection('auditlogs');
    const logs = await auditLogs
      .find({
        action: 'admin.permissions.catalog',
        entityType: 'Permission',
        userId: new Types.ObjectId(user.id),
      })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    expect(logs).toHaveLength(1);
  });
});
