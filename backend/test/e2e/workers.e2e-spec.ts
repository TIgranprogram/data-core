/**
 * TZ-WORKERS-301: workers e2e smoke.
 *
 * Проверяет CRUD /api/workers с новыми полями «Людей»:
 *  - create с email/supplierId/position (envelope в листинге);
 *  - org-scope (organizationId из req.user — у seeded-админа org нет,
 *    поэтому scope-фильтр не применяется и запись видна);
 *  - 404 на битый FK (workTypeId/supplierId);
 *  - 400 на фирму не-поставщика в supplierId;
 *  - 409 на email-коллизию в области;
 *  - soft-delete: после DELETE запись исчезает из листинга.
 *
 * Требует: запущенный Mongo (docker compose up -d mongo) + seeded admin.
 * Запуск: `pnpm run test:e2e test/e2e/workers.e2e-spec.ts`.
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

describe('Workers (TZ-WORKERS-301)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const { access } = await loginAsAdmin(app);
    adminToken = access;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('CRUD round-trip: create with new people fields, list envelope, soft-delete', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/workers')
      .set(authHeader(adminToken))
      .send({
        lastName: 'Иванов',
        firstName: 'Иван',
        patronymic: 'Иванович',
        email: 'IVAN@example.com',
        position: 'Менеджер по закупкам',
        phone: '+7 900 123-45-67',
        department: 'Закупки',
        ratePerHour: 800,
        isActive: true,
      })
      .expect(201);
    const workerId = create.body._id as string;
    expect(create.body.email).toBe('ivan@example.com');
    expect(create.body.position).toBe('Менеджер по закупкам');
    expect(Array.isArray(create.body.workTypeIds)).toBe(true);

    const list = await request(app.getHttpServer())
      .get('/api/workers')
      .set(authHeader(adminToken))
      .expect(200);
    expect(Array.isArray(list.body.items)).toBe(true);
    expect(typeof list.body.total).toBe('number');
    expect(list.body.items.find((w: { _id: string }) => w._id === workerId)).toBeDefined();

    const search = await request(app.getHttpServer())
      .get('/api/workers?search=иван')
      .set(authHeader(adminToken))
      .expect(200);
    expect(search.body.total).toBeGreaterThanOrEqual(1);

    const patch = await request(app.getHttpServer())
      .patch(`/api/workers/${workerId}`)
      .set(authHeader(adminToken))
      .send({ position: 'Директор по закупкам', email: 'director@example.com' })
      .expect(200);
    expect(patch.body.position).toBe('Директор по закупкам');
    expect(patch.body.email).toBe('director@example.com');

    await request(app.getHttpServer())
      .delete(`/api/workers/${workerId}`)
      .set(authHeader(adminToken))
      .expect(204);

    const after = await request(app.getHttpServer())
      .get('/api/workers')
      .set(authHeader(adminToken))
      .expect(200);
    expect(after.body.items.find((w: { _id: string }) => w._id === workerId)).toBeUndefined();
  });

  it('404 on broken workTypeId ref', async () => {
    await request(app.getHttpServer())
      .post('/api/workers')
      .set(authHeader(adminToken))
      .send({
        lastName: 'Петров',
        firstName: 'Пётр',
        workTypeIds: ['64b000000000000000000000'],
      })
      .expect(404);
  });

  it('400 when supplierId is not a supplier organization', async () => {
    // Создаём фирму типа customer (с валидным ИНН), затем пытаемся
    // привязать её как supplier.
    const org = await request(app.getHttpServer())
      .post('/api/organizations')
      .set(authHeader(adminToken))
      .send({ name: 'Фирма-клиент e2e', inn: '7707083893', type: ['customer'] })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/workers')
      .set(authHeader(adminToken))
      .send({
        lastName: 'Сидоров',
        firstName: 'Сидор',
        supplierId: org.body._id,
      })
      .expect(400);
  });

  it('409 on duplicate email (service pre-check)', async () => {
    await request(app.getHttpServer())
      .post('/api/workers')
      .set(authHeader(adminToken))
      .send({ lastName: 'Первый', firstName: 'А', email: 'dup@example.com' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/workers')
      .set(authHeader(adminToken))
      .send({ lastName: 'Второй', firstName: 'Б', email: 'DUP@example.com' })
      .expect(409);
  });

  it('strips unknown fields (whitelist) and rejects invalid email', async () => {
    // e2e-харнесс ставит ValidationPipe { whitelist: true } без
    // forbidNonWhitelisted (в отличие от production main.ts) — неизвестное
    // поле молча стрипуется, а не даёт 400. Проверяем, что оно НЕ
    // сохраняется, и что невалидный email всё равно отвергается валидатором.
    const created = await request(app.getHttpServer())
      .post('/api/workers')
      .set(authHeader(adminToken))
      .send({
        lastName: 'X',
        firstName: 'Y',
        organizationId: '64b000000000000000000000',
      })
      .expect(201);
    expect(created.body.organizationId).toBeUndefined();

    await request(app.getHttpServer())
      .post('/api/workers')
      .set(authHeader(adminToken))
      .send({ lastName: 'X', firstName: 'Y', email: 'not-an-email' })
      .expect(400);
  });
});
