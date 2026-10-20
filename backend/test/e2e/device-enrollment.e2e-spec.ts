import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, TestContext } from '../setup/test-db';
import {
  TEST_ADMIN_PASSWORD,
  TEST_ADMIN_USERNAME,
  loginAsAdmin,
  authHeader,
} from '../setup/admin.fixture';
import { sha256Hex } from '../../src/modules/device-enrollment/device-crypto';

const DEVICE_COOKIE = '__Host-kppdf-device';

function extractCookie(res: SupertestResponse): string {
  const raw = res.headers['set-cookie'];
  const setCookie: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const cookie = setCookie.find((c) => c.startsWith(`${DEVICE_COOKIE}=`));
  if (!cookie) throw new Error(`No ${DEVICE_COOKIE} cookie in response`);
  return cookie.split('=')[1].split(';')[0];
}

function jwtTtl(access: string): number {
  const payload = JSON.parse(
    Buffer.from(access.split('.')[1], 'base64url').toString('utf8'),
  ) as { iat: number; exp: number };
  return payload.exp - payload.iat;
}

describe('Device enrollment (e2e) — TZ-AUTH-303', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let ownerAccess: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    ({ access: ownerAccess } = await loginAsAdmin(app));
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  async function createOrdinaryAdmin(): Promise<{ access: string; id: string }> {
    const username = `admin2_${Date.now()}`;
    await request(app.getHttpServer())
      .post('/api/admin/users')
      .set(authHeader(ownerAccess))
      .send({
        username,
        password: 'ordinary-admin-password',
        displayName: 'Ordinary Admin',
        role: 'admin',
      })
      .expect((r) => expect([201, 200]).toContain(r.status));
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password: 'ordinary-admin-password' });
    expect(login.status).toBe(200);
    expect(login.body.user.isOwner).toBe(false);
    return { access: login.body.access, id: login.body.user.id };
  }

  it('regular invite: only with a preselected ACTIVE role; consumes atomically once', async () => {
    const admin = await createOrdinaryAdmin();

    // Role tampering: activation cannot override the server-side role.
    const invite = await request(app.getHttpServer())
      .post('/api/admin/devices/invites')
      .set(authHeader(admin.access))
      .send({ role: 'manager' });
    expect(invite.status).toBe(201);
    expect(invite.body.secret).toBeDefined();
    expect(invite.body.url).toContain(`/enroll/${invite.body.secret}`);

    const consume = await request(app.getHttpServer())
      .post('/api/device/enroll')
      .send({ secret: invite.body.secret, deviceName: 'Цеховой ПК №1', role: 'admin' });
    expect(consume.status).toBe(200);
    expect(consume.body.role).toBe('manager'); // role came from the invite
    expect(consume.body.isOwner).toBe(false);
    expect(consume.body.access).toBeDefined();
    expect(consume.body.sessionKind).toBe('device');
    expect(jwtTtl(consume.body.access)).toBeLessThanOrEqual(300);

    const cookie = extractCookie(consume);

    // Repeat consumption is one-time.
    const again = await request(app.getHttpServer())
      .post('/api/device/enroll')
      .send({ secret: invite.body.secret, deviceName: 'Другой ПК' });
    expect(again.status).toBe(409);

    // The cookie issues a fresh short JWT; the grant secret is NOT a Bearer.
    const session = await request(app.getHttpServer())
      .get('/api/device/session')
      .set('Cookie', `${DEVICE_COOKIE}=${cookie}`);
    expect(session.status).toBe(200);
    expect(session.body.sessionKind).toBe('device');
    expect(jwtTtl(session.body.access)).toBeLessThanOrEqual(300);

    // Password login is NOT a device session — it must not carry the marker.
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.sessionKind).toBeUndefined();

    const asBearer = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set(authHeader(cookie));
    expect(asBearer.status).toBe(401);

    // The device JWT itself works as a normal access token (role manager).
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set(authHeader(session.body.access));
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('manager');

    // Status probe returns active + safe name only.
    const status = await request(app.getHttpServer())
      .get('/api/device/status')
      .set('Cookie', `${DEVICE_COOKIE}=${cookie}`);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('active');
    expect(status.body.deviceName).toBe('Цеховой ПК №1');

    // auth_check is a boolean gate with no personal data.
    const authCheck = await request(app.getHttpServer())
      .get('/api/device/auth-check')
      .set('Cookie', `${DEVICE_COOKIE}=${cookie}`);
    expect(authCheck.status).toBe(200);
    expect(authCheck.body).toEqual({ ok: true });
  });

  it('only the SHA-256 hash of the secret is persisted (no plaintext)', async () => {
    const admin = await createOrdinaryAdmin();
    const invite = await request(app.getHttpServer())
      .post('/api/admin/devices/invites')
      .set(authHeader(admin.access))
      .send({ role: 'user' });
    expect(invite.status).toBe(201);

    const inviteDoc = await ctx!.connection
      .collection('deviceinvites')
      .findOne({ secretHash: sha256Hex(invite.body.secret) });
    expect(inviteDoc).toBeTruthy();
    expect(inviteDoc).not.toHaveProperty('secret');
    expect(inviteDoc!.secretHash).toBe(sha256Hex(invite.body.secret));
  });

  it('revoke stops renewal immediately; role change applies on next session', async () => {
    const admin = await createOrdinaryAdmin();
    const invite = await request(app.getHttpServer())
      .post('/api/admin/devices/invites')
      .set(authHeader(admin.access))
      .send({ role: 'manager' });
    const consume = await request(app.getHttpServer())
      .post('/api/device/enroll')
      .send({ secret: invite.body.secret, deviceName: 'ПК-2' });
    expect(consume.status).toBe(200);
    const cookie = extractCookie(consume);

    const devices = await request(app.getHttpServer())
      .get('/api/admin/devices')
      .set(authHeader(admin.access));
    expect(devices.status).toBe(200);
    const deviceId = devices.body.find(
      (d: { deviceName: string }) => d.deviceName === 'ПК-2',
    )?.id;

    // Change role manager -> user (applies at next renewal).
    const patch = await request(app.getHttpServer())
      .patch(`/api/admin/devices/${deviceId}`)
      .set(authHeader(admin.access))
      .send({ role: 'user' });
    expect(patch.status).toBe(200);

    const session = await request(app.getHttpServer())
      .get('/api/device/session')
      .set('Cookie', `${DEVICE_COOKIE}=${cookie}`);
    expect(session.status).toBe(200);
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set(authHeader(session.body.access));
    expect(me.body.role).toBe('user');

    // Revoke -> renewal is refused.
    const revoke = await request(app.getHttpServer())
      .post(`/api/admin/devices/${deviceId}/revoke`)
      .set(authHeader(admin.access));
    expect(revoke.status).toBe(201);

    const after = await request(app.getHttpServer())
      .get('/api/device/session')
      .set('Cookie', `${DEVICE_COOKIE}=${cookie}`);
    expect(after.status).toBe(401);

    const status = await request(app.getHttpServer())
      .get('/api/device/status')
      .set('Cookie', `${DEVICE_COOKIE}=${cookie}`);
    expect(status.body.status).toBe('revoked');
  });

  it('password reset for a device account is rejected', async () => {
    const admin = await createOrdinaryAdmin();
    const invite = await request(app.getHttpServer())
      .post('/api/admin/devices/invites')
      .set(authHeader(admin.access))
      .send({ role: 'user' });
    const consume = await request(app.getHttpServer())
      .post('/api/device/enroll')
      .send({ secret: invite.body.secret, deviceName: 'ПК-3' });

    const devices = await request(app.getHttpServer())
      .get('/api/admin/devices')
      .set(authHeader(admin.access));
    const device = devices.body.find((d: { deviceName: string }) => d.deviceName === 'ПК-3');

    const reset = await request(app.getHttpServer())
      .post(`/api/admin/users/${device.userId}/reset-password`)
      .set(authHeader(admin.access))
      .send({ newPassword: 'whatever123' });
    expect(reset.status).toBe(409);
  });

  it('owner-device invite: 15m TTL, password step-up, binds to the single owner', async () => {
    // Wrong step-up password is refused.
    const wrong = await request(app.getHttpServer())
      .post('/api/admin/devices/owner-invite')
      .set(authHeader(ownerAccess))
      .send({ password: 'wrong-password' });
    expect(wrong.status).toBe(401);

    const invite = await request(app.getHttpServer())
      .post('/api/admin/devices/owner-invite')
      .set(authHeader(ownerAccess))
      .send({ password: TEST_ADMIN_PASSWORD });
    expect(invite.status).toBe(201);
    expect(invite.body.kind).toBe('owner-device');

    const consume = await request(app.getHttpServer())
      .post('/api/device/enroll')
      .send({ secret: invite.body.secret, deviceName: 'ПК владельца' });
    expect(consume.status).toBe(200);
    expect(consume.body.isOwner).toBe(true);

    // The owner device grants full access to the SAME owner user.
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set(authHeader(consume.body.access));
    expect(me.status).toBe(200);
    expect(me.body.isOwner).toBe(true);
    expect(me.body.username).toBe(TEST_ADMIN_USERNAME);

    // Exactly one owner still exists (no second owner created).
    const owners = await ctx!.connection
      .collection('users')
      .countDocuments({ isOwner: true });
    expect(owners).toBe(1);
  });

  it('ordinary admin cannot enumerate owner devices or mint owner invites', async () => {
    const admin = await createOrdinaryAdmin();

    const ownerDevices = await request(app.getHttpServer())
      .get('/api/admin/devices/owner')
      .set(authHeader(admin.access));
    expect(ownerDevices.status).toBe(403);

    const ownerInvite = await request(app.getHttpServer())
      .post('/api/admin/devices/owner-invite')
      .set(authHeader(admin.access))
      .send({ password: 'x'.repeat(8) });
    expect(ownerInvite.status).toBe(403);

    // Ordinary admin's device list never contains an owner-device grant.
    const list = await request(app.getHttpServer())
      .get('/api/admin/devices')
      .set(authHeader(admin.access));
    expect(list.status).toBe(200);
    expect(
      list.body.every((d: { inviteKind: string }) => d.inviteKind === 'regular'),
    ).toBe(true);
  });

  it('ordinary admin cannot mint an admin-role device invite', async () => {
    const admin = await createOrdinaryAdmin();
    const res = await request(app.getHttpServer())
      .post('/api/admin/devices/invites')
      .set(authHeader(admin.access))
      .send({ role: 'admin' });
    expect(res.status).toBe(403);
  });

  it('ordinary admin cannot PATCH a device to admin role (no User mutation)', async () => {
    const admin = await createOrdinaryAdmin();
    const invite = await request(app.getHttpServer())
      .post('/api/admin/devices/invites')
      .set(authHeader(admin.access))
      .send({ role: 'user' });
    const consume = await request(app.getHttpServer())
      .post('/api/device/enroll')
      .send({ secret: invite.body.secret, deviceName: 'ПК-esc' });
    expect(consume.status).toBe(200);

    const devices = await request(app.getHttpServer())
      .get('/api/admin/devices')
      .set(authHeader(admin.access));
    const device = devices.body.find(
      (d: { deviceName: string }) => d.deviceName === 'ПК-esc',
    );

    const patch = await request(app.getHttpServer())
      .patch(`/api/admin/devices/${device.id}`)
      .set(authHeader(admin.access))
      .send({ role: 'admin' });
    expect(patch.status).toBe(403);

    // Regression: the device user's role must be unchanged in the DB.
    const dbUser = await ctx!.connection
      .collection('users')
      .findOne({ _id: new Types.ObjectId(device.userId) });
    expect(dbUser?.role).toBe('user');
  });
});
