/**
 * TZ-86 Phase F.1.2 — TableTemplate e2e.
 *
 * Coverage:
 *  - POST /api/table-templates — creates with columns + sampleRows
 *  - GET /api/table-templates — list returns array
 *  - GET /api/table-templates/:id — single doc
 *  - GET /api/table-templates/:id/preview — returns text/html with column headers + row data
 *  - GET /api/table-templates/:id/preview — currency cells use Intl.NumberFormat('ru-RU', RUB)
 *  - GET /api/table-templates/:id/preview — empty sampleRows keeps a table skeleton
 *  - PATCH /api/table-templates/:id — updates name
 *  - DELETE /api/table-templates/:id — soft-deletes (subsequent GET 404)
 *
 * Run: `pnpm test:e2e test/e2e/table-templates.e2e-spec.ts`
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

describe('TableTemplates (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let auth: { Authorization: string };
  const created: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const { access } = await loginAsAdmin(app);
    auth = authHeader(access);
  });

  afterAll(async () => {
    for (const id of created) {
      await request(app.getHttpServer())
        .delete(`/api/table-templates/${id}`)
        .set(auth)
        .catch(() => undefined);
    }
    await ctx.cleanup();
  });

  it('POST /table-templates — creates with columns + sampleRows', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/table-templates')
      .set(auth)
      .send({
        name: 'Test Table',
        description: 'Test description',
        category: 'product-spec',
        columns: [
          { key: 'name', label: 'Наименование', type: 'text' },
          { key: 'price', label: 'Цена', type: 'currency' },
          { key: 'qty', label: 'Кол-во', type: 'number' },
        ],
        sampleRows: [
          ['Лист ЛДСП', 1000, 5],
          ['Кромка', 50, 20],
        ],
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.name).toBe('Test Table');
    expect(res.body.columns).toHaveLength(3);
    expect(res.body.sampleRows).toHaveLength(2);
    expect(res.body.category).toBe('product-spec');
    created.push(res.body._id);
  });

  it('GET /table-templates — list returns array and idempotent KP preset', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/table-templates')
      .set(auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const kpPreset = res.body.find(
      (template: { name?: string; category?: string }) =>
        template.name === 'КП — позиции' && template.category === 'kp',
    );
    expect(kpPreset?.isActive).toBe(true);
    expect(kpPreset?.columns.map((column: { key: string }) => column.key)).toEqual([
      'index',
      'productName',
      'quantity',
      'unit',
      'unitPrice',
      'sum',
    ]);
  });

  it('POST /table-templates — accepts category kp with canonical columns', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/table-templates')
      .set(auth)
      .send({
        name: 'KP preset copy',
        category: 'kp',
        columns: [
          { key: 'index', label: '№', type: 'number' },
          { key: 'productName', label: 'Наименование', type: 'text' },
          { key: 'quantity', label: 'Кол-во', type: 'number' },
          { key: 'unit', label: 'Ед.', type: 'text' },
          { key: 'unitPrice', label: 'Цена', type: 'currency' },
          { key: 'sum', label: 'Сумма', type: 'currency' },
        ],
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.category).toBe('kp');
    expect(res.body.columns.map((column: { key: string }) => column.key)).toEqual([
      'index',
      'productName',
      'quantity',
      'unit',
      'unitPrice',
      'sum',
    ]);
    created.push(res.body._id);
  });

  it('GET /table-templates/:id — single doc', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/table-templates')
      .set(auth)
      .send({
        name: 'Single Table',
        columns: [{ key: 'x', label: 'X', type: 'text' }],
      });
    expect([200, 201]).toContain(create.status);
    created.push(create.body._id);

    const res = await request(app.getHttpServer())
      .get(`/api/table-templates/${create.body._id}`)
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Single Table');
  });

  it('GET /table-templates/:id/preview — text/html with column headers + row data', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/table-templates')
      .set(auth)
      .send({
        name: 'Preview Test',
        columns: [
          { key: 'name', label: 'Имя', type: 'text' },
          { key: 'qty', label: 'Кол-во', type: 'number' },
        ],
        sampleRows: [['Тестовая строка', 7]],
      });
    expect([200, 201]).toContain(create.status);
    created.push(create.body._id);

    const res = await request(app.getHttpServer())
      .get(`/api/table-templates/${create.body._id}/preview`)
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Имя');
    expect(res.text).toContain('Кол-во');
    expect(res.text).toContain('Тестовая строка');
  });

  it('GET /table-templates/:id/preview — currency cells use Intl.NumberFormat (ru-RU, RUB)', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/table-templates')
      .set(auth)
      .send({
        name: 'Currency Test',
        columns: [
          { key: 'price', label: 'Цена', type: 'currency' },
        ],
        sampleRows: [[1234.56]],
      });
    expect([200, 201]).toContain(create.status);
    created.push(create.body._id);

    const res = await request(app.getHttpServer())
      .get(`/api/table-templates/${create.body._id}/preview`)
      .set(auth);
    expect(res.status).toBe(200);
    // Intl ru-RU currency: "1 234,56 ₽" (or similar grouping-separator)
    expect(res.text).toMatch(/1.234,56.?\s*₽/);
  });

  it('GET /table-templates/:id/preview — empty sampleRows returns one blank table row', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/table-templates')
      .set(auth)
      .send({
        name: 'Empty rows',
        columns: [{ key: 'x', label: 'X', type: 'text' }],
      });
    expect([200, 201]).toContain(create.status);
    created.push(create.body._id);

    const res = await request(app.getHttpServer())
      .get(`/api/table-templates/${create.body._id}/preview`)
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<table');
    expect(res.text).toContain('<thead>');
    expect(res.text).toContain('<th');
    expect(res.text).toContain('<tbody><tr>');
    expect(res.text).toContain('<td style="text-align:left"></td>');
    expect(res.text).not.toContain('Нет данных');
  });

  it('PATCH /table-templates/:id — updates name', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/table-templates')
      .set(auth)
      .send({
        name: 'Before PATCH',
        columns: [{ key: 'x', label: 'X', type: 'text' }],
      });
    expect([200, 201]).toContain(create.status);
    created.push(create.body._id);

    const res = await request(app.getHttpServer())
      .patch(`/api/table-templates/${create.body._id}`)
      .set(auth)
      .send({ name: 'After PATCH' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('After PATCH');
  });

  it('DELETE /table-templates/:id — soft-deletes (subsequent GET returns 404)', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/table-templates')
      .set(auth)
      .send({
        name: 'ToDelete',
        columns: [{ key: 'x', label: 'X', type: 'text' }],
      });
    expect([200, 201]).toContain(create.status);
    // Do NOT push to `created` — already deleted.

    const del = await request(app.getHttpServer())
      .delete(`/api/table-templates/${create.body._id}`)
      .set(auth);
    expect([200, 204]).toContain(del.status);

    const get = await request(app.getHttpServer())
      .get(`/api/table-templates/${create.body._id}`)
      .set(auth);
    expect(get.status).toBe(404);
  });
});
