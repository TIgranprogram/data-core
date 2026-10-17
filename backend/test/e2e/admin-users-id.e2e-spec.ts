import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';

/**
 * Контракт админ-списков, от которого зависит статическая админка.
 *
 * `backend/admin/admin.js` шлёт `/admin/users/<id>` и
 * `/desktop/pairing-keys/<id>/revoke`. Раньше UI читал `u._id`, а API
 * отдаёт mongoose-virtual `id` — в итоге «Изменить» терял id (диалог
 * уходил в создание), а «Сброс пароля» и «Удалить» уходили на
 * `/admin/users/undefined` → CastError → HTTP 500.
 *
 * Этот тест фиксирует: элементы списков обязаны содержать строковый `id`,
 * а `_id` не должен быть единственным носителем идентификатора.
 */
describe('Admin list id contract (admin UI dependency)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('GET /admin/users returns items with a usable `id`', async () => {
    const { access } = await loginAsAdmin(app);

    const res = await request(app.getHttpServer())
      .get('/api/admin/users')
      .set(authHeader(access))
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    for (const item of res.body.items as Record<string, unknown>[]) {
      expect(typeof item.id).toBe('string');
      expect(String(item.id)).toMatch(/^[0-9a-f]{24}$/);
    }

    // Сам админ всегда есть — он же нужен для проверки удаления ниже.
    const admin = (res.body.items as { id: string; username: string }[]).find(
      (u) => u.username === 'admin',
    );
    expect(admin).toBeDefined();
  });

  it('user id from the list works for GET / PATCH / DELETE (no 500 on `undefined`)', async () => {
    const { access } = await loginAsAdmin(app);
    const stamp = Date.now();
    const username = `id-contract-${stamp}`;

    const created = await request(app.getHttpServer())
      .post('/api/admin/users')
      .set(authHeader(access))
      .send({ username, password: `Contract-Pass-${stamp}`, role: 'user' })
      .expect(201);

    // Форма, которую получает UI сразу после создания.
    const newId: string = created.body.id ?? created.body._id;
    expect(typeof newId).toBe('string');

    // Тот же id должен быть виден в списке — именно его берёт UI.
    const list = await request(app.getHttpServer())
      .get('/api/admin/users')
      .set(authHeader(access))
      .expect(200);
    const fromList = (list.body.items as { id: string; username: string }[]).find(
      (u) => u.username === username,
    );
    expect(fromList?.id).toBe(newId);

    // GET / PATCH по id из списка.
    await request(app.getHttpServer())
      .get(`/api/admin/users/${newId}`)
      .set(authHeader(access))
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${newId}`)
      .set(authHeader(access))
      .send({ displayName: 'Contract Renamed' })
      .expect(200); // PATCH по умолчанию 200 в Nest

    // DELETE по id из списка — раньше тут падал CastError на "undefined".
    await request(app.getHttpServer())
      .delete(`/api/admin/users/${newId}`)
      .set(authHeader(access))
      .expect(200);

    const after = await request(app.getHttpServer())
      .get('/api/admin/users')
      .set(authHeader(access))
      .expect(200);
    expect(
      (after.body.items as { username: string }[]).some((u) => u.username === username),
    ).toBe(false);
  });

  it('DELETE /admin/users/undefined is 400, not a 500 CastError', async () => {
    const { access } = await loginAsAdmin(app);
    const res = await request(app.getHttpServer())
      .delete('/api/admin/users/undefined')
      .set(authHeader(access));

    // Раньше mongoose CastError улетал наружу как 500 со стеком в логах.
    // Теперь это штатный 400 с понятным сообщением.
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/идентификатор/i);
  });

  it('GET /desktop/pairing-keys returns items with a usable `id`', async () => {
    const { access } = await loginAsAdmin(app);

    const issued = await request(app.getHttpServer())
      .post('/api/desktop/pairing-keys')
      .set(authHeader(access))
      .send({
        label: `id-contract-key-${Date.now()}`,
        ttl: '7d',
        // apiBaseUrl обязателен (@IsUrl) — без него POST /pairing-keys → 400.
        apiBaseUrl: 'http://localhost:3001',
      })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/api/desktop/pairing-keys')
      .set(authHeader(access))
      .expect(200);

    const items = list.body as { id: string; label: string }[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(typeof item.id).toBe('string');
      expect(String(item.id)).toMatch(/^[0-9a-f]{24}$/);
    }

    // Именно этот id уходит в /revoke из админки.
    const mine = items.find((k) => k.label === issued.body.label);
    expect(mine).toBeDefined();
    // Без этого revoke молча уходит на /pairing-keys/undefined/revoke и
    // отвечает 404 «Key not found», что выглядит как поломка роута.
    expect(mine!.id).toBe(issued.body.id);

    const revokeRes = await request(app.getHttpServer())
      .post(`/api/desktop/pairing-keys/${mine!.id}/revoke`)
      .set(authHeader(access));

    expect(revokeRes.status).toBe(201);
  });
});
