import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { createTestApp, TestContext, clearCollections } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/admin.fixture';
import { MetaService } from '../../src/modules/meta/meta.controller';
import { buildSwaggerConfig } from '../../src/swagger.config';

/** /api/meta/* — самоописание API: доступно любому ключу (в т.ч. read), без ключа — 401. */
describe('Meta (e2e)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let readKey: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    // Как в main.ts: OpenAPI собирается при старте и отдаётся через MetaService.
    app.get(MetaService).setOpenApi(SwaggerModule.createDocument(app, buildSwaggerConfig()));
    const jwt = (await loginAsAdmin(app)).access;
    await clearCollections(ctx.connection, ['desktop_pairing_keys']);
    const r = await http()
      .post('/api/desktop/pairing-keys')
      .set(authHeader(jwt))
      .send({ apiBaseUrl: 'http://localhost:3001', label: 'e2e-meta-read', scope: { access: 'read' } });
    expect(r.status).toBe(201);
    readKey = r.body.apiKey;
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('GET /api — публичная справка вместо 404', async () => {
    const res = await http().get('/api').expect(200);
    expect(res.body).toMatchObject({ name: 'Data Core API', status: 'ok' });
    expect(Object.keys(res.body.next)).toContain('meta/guide');
  });

  it('без ключа — 401', async () => {
    await http().get('/api/meta/schema').expect(401);
    await http().get('/api/meta/guide').expect(401);
  });

  it('schema: таблицы и поля из моделей, без секретов', async () => {
    const res = await http().get('/api/meta/schema').set(authHeader(readKey)).expect(200);
    const byColl = Object.fromEntries(res.body.collections.map((c: { collection: string }) => [c.collection, c]));
    const materials = byColl.materials;
    expect(materials).toBeDefined();
    const fields = materials.fields.map((f: { path: string }) => f.path);
    expect(fields).toEqual(expect.arrayContaining(['name', 'article', 'unit']));
    const users = byColl.users;
    expect(users.fields.map((f: { path: string }) => f.path)).not.toContain('passwordHash');
  });

  it('openapi.json: полный контракт, включая /api/meta', async () => {
    const res = await http().get('/api/meta/openapi.json').set(authHeader(readKey)).expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(Object.keys(res.body.paths)).toEqual(expect.arrayContaining(['/api/materials', '/api/meta/schema']));
  });

  it('guide: markdown-инструкция для ИИ', async () => {
    const res = await http().get('/api/meta/guide').set(authHeader(readKey)).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown/);
    expect(res.text).toContain('/meta/schema');
    expect(res.text).toContain('/apps/<app>/<collection>');
  });
});
