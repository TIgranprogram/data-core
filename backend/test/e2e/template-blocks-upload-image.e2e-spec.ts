/**
 * TZ-DOC-333 — TemplateBlock photo upload e2e (mirror of
 * document-templates-upload-background.e2e-spec.ts).
 *
 * Coverage:
 *  - POST /api/template-blocks/:id/image with valid PNG → 201 + { url }
 *  - URL matches /uploads/template-blocks/{blockId}/{uuid}.{ext}
 *  - block.settings.imageUrl persisted with the returned URL
 *  - second upload REPLACES settings.imageUrl (1 block → 1 current image)
 *  - POST with invalid MIME (text/plain) → 400 (fileFilter rejects)
 *  - POST with file > 5MB → 413 (MulterExceptionFilter maps LIMIT_FILE_SIZE)
 *  - POST to non-existent block → 404 (findById throws)
 *  - create with settings.imageUrl = "blob:…" → 400 (reject ephemeral URL)
 *  - create with settings.imageUrl = "data:…" → 400
 *  - update (PATCH) with settings.imageUrl = "blob:…" → 400
 *  - create with settings.imageUrl = "/uploads/..." → allowed (no 400)
 *
 * Run: `pnpm test:e2e test/e2e/template-blocks-upload-image.e2e-spec.ts`
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, TestContext } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

// 1x1 transparent PNG, 67 bytes. Valid signature + IHDR + IDAT + IEND.
const PNG_1x1 = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82,
]);

/** 6 MB+ buffer — exceeds the 5 MB multer.limits.fileSize cap. */
const PNG_TOO_LARGE = Buffer.alloc(6 * 1024 * 1024 + 16);
PNG_TOO_LARGE.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0);

async function createTestTemplate(
  app: INestApplication,
  auth: { Authorization: string },
  name: string,
): Promise<string> {
  const orgId = new Types.ObjectId().toString();
  const docTypeId = new Types.ObjectId().toString();
  const res = await request(app.getHttpServer())
    .post('/api/document-templates')
    .set(auth)
    .send({ name, organizationId: orgId, docTypeId });
  expect([200, 201]).toContain(res.status);
  return res.body._id;
}

async function createImageBlock(
  app: INestApplication,
  auth: { Authorization: string },
  templateId: string,
  settings?: Record<string, unknown>,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`/api/document-templates/${templateId}/blocks`)
    .set(auth)
    .send({ type: 'image', order: 0, ...(settings ? { settings } : {}) });
  expect([200, 201]).toContain(res.status);
  return res.body._id;
}

describe('TemplateBlocks upload-image (e2e / TZ-DOC-333)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let auth: { Authorization: string };
  const createdTemplates: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const { access } = await loginAsAdmin(app);
    auth = authHeader(access);
  });

  afterAll(async () => {
    for (const id of createdTemplates) {
      await request(app.getHttpServer())
        .delete(`/api/document-templates/${id}`)
        .set(auth)
        .catch(() => undefined);
    }
    await ctx.cleanup();
  });

  it('POST image with valid PNG → 201 + /uploads/template-blocks/{id}/{uuid}.png + settings persisted', async () => {
    const templateId = await createTestTemplate(app, auth, 'Block Photo Upload Test');
    createdTemplates.push(templateId);
    const blockId = await createImageBlock(app, auth, templateId);

    const res = await request(app.getHttpServer())
      .post(`/api/template-blocks/${blockId}/image`)
      .set(auth)
      .attach('file', PNG_1x1, { filename: 'test.png', contentType: 'image/png' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.url).toMatch(
      /^\/uploads\/template-blocks\/[a-f0-9]{24}\/[a-f0-9-]{36}\.png$/,
    );

    const get = await request(app.getHttpServer())
      .get(`/api/template-blocks/${blockId}`)
      .set(auth);
    expect(get.status).toBe(200);
    expect(get.body.settings.imageUrl).toBe(res.body.url);
  });

  it('second upload replaces settings.imageUrl (no blob, new URL)', async () => {
    const templateId = await createTestTemplate(app, auth, 'Block Photo Replace Test');
    createdTemplates.push(templateId);
    const blockId = await createImageBlock(app, auth, templateId);

    await request(app.getHttpServer())
      .post(`/api/template-blocks/${blockId}/image`)
      .set(auth)
      .attach('file', PNG_1x1, { filename: 'a.png', contentType: 'image/png' });

    const res2 = await request(app.getHttpServer())
      .post(`/api/template-blocks/${blockId}/image`)
      .set(auth)
      .attach('file', PNG_1x1, { filename: 'b.png', contentType: 'image/png' });
    expect([200, 201]).toContain(res2.status);
    expect(res2.body.url).not.toBeUndefined();

    const get = await request(app.getHttpServer())
      .get(`/api/template-blocks/${blockId}`)
      .set(auth);
    expect(get.body.settings.imageUrl).toBe(res2.body.url);
  });

  it('POST image with invalid MIME (text/plain) → 400', async () => {
    const templateId = await createTestTemplate(app, auth, 'Block Photo BadMime');
    createdTemplates.push(templateId);
    const blockId = await createImageBlock(app, auth, templateId);

    const res = await request(app.getHttpServer())
      .post(`/api/template-blocks/${blockId}/image`)
      .set(auth)
      .attach('file', Buffer.from('hello'), {
        filename: 'test.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(400);
  });

  it('POST image with file > 5MB → 413', async () => {
    const templateId = await createTestTemplate(app, auth, 'Block Photo LargeFile');
    createdTemplates.push(templateId);
    const blockId = await createImageBlock(app, auth, templateId);

    const res = await request(app.getHttpServer())
      .post(`/api/template-blocks/${blockId}/image`)
      .set(auth)
      .attach('file', PNG_TOO_LARGE, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
  });

  it('POST image to non-existent block → 404', async () => {
    const fakeId = new Types.ObjectId().toString();
    const res = await request(app.getHttpServer())
      .post(`/api/template-blocks/${fakeId}/image`)
      .set(auth)
      .attach('file', PNG_1x1, { filename: 'test.png', contentType: 'image/png' });
    expect(res.status).toBe(404);
  });

  it('create with settings.imageUrl "blob:…" → 400', async () => {
    const templateId = await createTestTemplate(app, auth, 'Block Photo RejectBlob');
    createdTemplates.push(templateId);

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/blocks`)
      .set(auth)
      .send({
        type: 'image',
        order: 0,
        settings: { imageUrl: 'blob:http://localhost:4200/abc-123' },
      });
    expect(res.status).toBe(400);
  });

  it('create with settings.imageUrl "data:…" → 400', async () => {
    const templateId = await createTestTemplate(app, auth, 'Block Photo RejectData');
    createdTemplates.push(templateId);

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/blocks`)
      .set(auth)
      .send({
        type: 'image',
        order: 0,
        settings: { imageUrl: 'data:image/png;base64,AAAA' },
      });
    expect(res.status).toBe(400);
  });

  it('create with settings.imageUrl containing "../" → 400 (path traversal guard)', async () => {
    const templateId = await createTestTemplate(app, auth, 'Block Photo RejectTraversal');
    createdTemplates.push(templateId);

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/blocks`)
      .set(auth)
      .send({
        type: 'image',
        order: 0,
        settings: { imageUrl: '/uploads/../../etc/passwd' },
      });
    expect(res.status).toBe(400);
  });

  it('update (PATCH) with settings.imageUrl "blob:…" → 400', async () => {
    const templateId = await createTestTemplate(app, auth, 'Block Photo PatchRejectBlob');
    createdTemplates.push(templateId);
    const blockId = await createImageBlock(app, auth, templateId);

    const res = await request(app.getHttpServer())
      .patch(`/api/template-blocks/${blockId}`)
      .set(auth)
      .send({ settings: { imageUrl: 'blob:http://localhost:4200/def-456' } });
    expect(res.status).toBe(400);
  });

  it('create with settings.imageUrl "/uploads/..." → allowed (no 400)', async () => {
    const templateId = await createTestTemplate(app, auth, 'Block Photo AllowUploads');
    createdTemplates.push(templateId);

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/blocks`)
      .set(auth)
      .send({
        type: 'image',
        order: 0,
        settings: { imageUrl: '/uploads/template-blocks/fake/legacy.png', overlay: true },
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.settings.imageUrl).toBe('/uploads/template-blocks/fake/legacy.png');
  });
});
