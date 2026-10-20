/**
 * TZ-ORG-ASSETS-301 — типизированное хранилище файлов организации.
 *
 * Покрытие:
 *  - PUT /organizations/:id/assets/logo → слот заполнен, storageUrl из /uploads
 *  - повторная загрузка ЗАМЕНЯЕТ слот (1 роль → 1 актуальный файл)
 *  - PUT без файла → 400, неизвестный слот → 404
 *  - печать: manager → 403, admin → 200
 *  - DELETE снимает файл; повторный DELETE → 404
 *  - чужие роли не затираются при замене логотипа
 *
 * Run: `npm run test:e2e -- test/e2e/organization-assets.e2e-spec.ts`
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { createTestApp, TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/test-auth';
import { User, UserDocument } from '../../src/modules/user/user.schema';

// 1x1 transparent PNG, 67 bytes.
const PNG_1x1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

/** Валидный по контрольной сумме 10-значный ИНН — иначе DTO вернёт 400. */
function makeInn(seed: number): string {
  const body = String(100000000 + (seed % 900000000));
  const weights = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(body[i]), 0);
  return `${body}${((sum % 11) % 10).toString()}`;
}

interface AssetRow {
  role: string;
  storageUrl: string;
  photoId: string;
  originalFilename?: string;
}

describe('Organization typed asset vault (e2e / TZ-ORG-ASSETS-301)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let admin: { Authorization: string };
  let manager: { Authorization: string };
  let innSeed = Date.now();

  async function createOrg(name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/organizations')
      .set(admin)
      .send({ name, inn: makeInn(innSeed++) });
    expect([200, 201]).toContain(res.status);
    return res.body._id;
  }

  async function assetsOf(id: string): Promise<AssetRow[]> {
    const res = await request(app.getHttpServer()).get(`/api/organizations/${id}`).set(admin);
    expect(res.status).toBe(200);
    return (res.body.assets ?? []) as AssetRow[];
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const { access } = await loginAsAdmin(app);
    admin = authHeader(access);

    // Печать обязан отбивать не-админа, поэтому нужен реальный manager-токен.
    const users = app.get<Model<UserDocument>>(getModelToken(User.name));
    const username = `assets301-manager-${Date.now()}`;
    await users.create({
      username,
      email: `${username}@kppdf.local`,
      displayName: 'TZ-ORG-ASSETS-301 manager',
      passwordHash: await bcrypt.hash('assets301-password', 10),
      role: 'manager',
      permissions: [],
      isActive: true,
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password: 'assets301-password' });
    expect([200, 201]).toContain(login.status);
    manager = authHeader(login.body.access);
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('PUT logo fills the slot and keeps a single current file per role', async () => {
    const id = await createOrg('ООО Слоты Логотип');

    const first = await request(app.getHttpServer())
      .put(`/api/organizations/${id}/assets/logo`)
      .set(admin)
      .attach('file', PNG_1x1, { filename: 'logo.png', contentType: 'image/png' });
    expect(first.status).toBe(200);

    const afterFirst = await assetsOf(id);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]!.role).toBe('logo');
    expect(afterFirst[0]!.storageUrl).toMatch(/^\/uploads\/[a-f0-9-]{36}\.png$/);
    expect(afterFirst[0]!.originalFilename).toBe('logo.png');

    const second = await request(app.getHttpServer())
      .put(`/api/organizations/${id}/assets/logo`)
      .set(admin)
      .attach('file', PNG_1x1, { filename: 'logo-v2.png', contentType: 'image/png' });
    expect(second.status).toBe(200);

    const afterSecond = await assetsOf(id);
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]!.originalFilename).toBe('logo-v2.png');
    expect(afterSecond[0]!.storageUrl).not.toBe(afterFirst[0]!.storageUrl);
  });

  it('replacing the logo does not touch the signature slot', async () => {
    const id = await createOrg('ООО Слоты Соседи');

    await request(app.getHttpServer())
      .put(`/api/organizations/${id}/assets/signature`)
      .set(admin)
      .attach('file', PNG_1x1, { filename: 'sign.png', contentType: 'image/png' });
    await request(app.getHttpServer())
      .put(`/api/organizations/${id}/assets/logo`)
      .set(admin)
      .attach('file', PNG_1x1, { filename: 'logo.png', contentType: 'image/png' });
    await request(app.getHttpServer())
      .put(`/api/organizations/${id}/assets/logo`)
      .set(admin)
      .attach('file', PNG_1x1, { filename: 'logo2.png', contentType: 'image/png' });

    const assets = await assetsOf(id);
    expect(assets.map((a) => a.role).sort()).toEqual(['logo', 'signature']);
  });

  it('PUT without a file → 400 and unknown slot → 404', async () => {
    const id = await createOrg('ООО Слоты Отказы');

    const noFile = await request(app.getHttpServer())
      .put(`/api/organizations/${id}/assets/logo`)
      .set(admin);
    expect(noFile.status).toBe(400);

    const badRole = await request(app.getHttpServer())
      .put(`/api/organizations/${id}/assets/stamp`)
      .set(admin)
      .attach('file', PNG_1x1, { filename: 'x.png', contentType: 'image/png' });
    expect(badRole.status).toBe(404);
  });

  it('seal is admin-only: manager gets 403, admin succeeds', async () => {
    const id = await createOrg('ООО Слоты Печать');

    const asManager = await request(app.getHttpServer())
      .put(`/api/organizations/${id}/assets/seal`)
      .set(manager)
      .attach('file', PNG_1x1, { filename: 'seal.png', contentType: 'image/png' });
    expect(asManager.status).toBe(403);
    expect(await assetsOf(id)).toHaveLength(0);

    const asAdmin = await request(app.getHttpServer())
      .put(`/api/organizations/${id}/assets/seal`)
      .set(admin)
      .attach('file', PNG_1x1, { filename: 'seal.png', contentType: 'image/png' });
    expect(asAdmin.status).toBe(200);
    expect(await assetsOf(id)).toHaveLength(1);

    const dropAsManager = await request(app.getHttpServer())
      .delete(`/api/organizations/${id}/assets/seal`)
      .set(manager);
    expect(dropAsManager.status).toBe(403);
  });

  it('DELETE clears the slot; deleting an empty slot → 404', async () => {
    const id = await createOrg('ООО Слоты Снятие');

    await request(app.getHttpServer())
      .put(`/api/organizations/${id}/assets/logo`)
      .set(admin)
      .attach('file', PNG_1x1, { filename: 'logo.png', contentType: 'image/png' });

    const removed = await request(app.getHttpServer())
      .delete(`/api/organizations/${id}/assets/logo`)
      .set(admin);
    expect(removed.status).toBe(200);
    expect(await assetsOf(id)).toHaveLength(0);

    const again = await request(app.getHttpServer())
      .delete(`/api/organizations/${id}/assets/logo`)
      .set(admin);
    expect(again.status).toBe(404);
  });

  it('unknown organization → 404 (no IDOR hint)', async () => {
    const fakeId = new Types.ObjectId().toString();
    const res = await request(app.getHttpServer())
      .put(`/api/organizations/${fakeId}/assets/logo`)
      .set(admin)
      .attach('file', PNG_1x1, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(404);
  });
});
