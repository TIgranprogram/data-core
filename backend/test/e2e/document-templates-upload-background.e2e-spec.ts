/**
 * TZ-86 Phase F.1.5 — DocumentTemplate upload-background e2e.
 *
 * Coverage:
 *  - POST /api/document-templates/:id/upload-background with valid PNG → 201 + URL
 *  - POST without multipart `file` → 400 (not 500) — TZ-DOC-342
 *  - URL matches /uploads/document-templates/{id}/{uuid}.{ext}
 *  - backgroundImage array contains the new URL
 *  - POST with invalid MIME (text/plain) → 400 (fileFilter rejects)
 *  - POST with file > 5MB → 413 (MulterExceptionFilter maps LIMIT_FILE_SIZE)
 *  - POST to non-existent template → 404 (findById throws)
 *  - POST 5 valid images → all 201; 6th → 409 (MAX_BACKGROUND_IMAGES cap)
 *
 * Run: `pnpm test:e2e test/e2e/document-templates-upload-background.e2e-spec.ts`
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

/**
 * 6 MB+ PNG-like buffer (exceeds the 5 MB multer.limits.fileSize cap).
 * PNG signature at the start so the fileFilter accepts it as image/png;
 * the size check then fires during streaming → MulterError('LIMIT_FILE_SIZE')
 * → 413 via MulterExceptionFilter.
 */
const PNG_TOO_LARGE = Buffer.alloc(6 * 1024 * 1024 + 16);
PNG_TOO_LARGE.set(
  [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  0,
);

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
    .send({
      name,
      organizationId: orgId,
      docTypeId,
    });
  expect([200, 201]).toContain(res.status);
  return res.body._id;
}

describe('DocumentTemplates upload-background (e2e)', () => {
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

  it('POST upload-background without file field → 400 (not 500)', async () => {
    const templateId = await createTestTemplate(app, auth, 'Missing File Upload Test');
    createdTemplates.push(templateId);

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/upload-background`)
      .set(auth)
      .field('notFile', 'x');
    expect(res.status).toBe(400);
    const message = String(res.body?.message ?? '');
    expect(message).toContain('Файл не получен');
  });

  it('POST upload-background with valid PNG → 201 + URL in backgroundImage', async () => {
    const templateId = await createTestTemplate(app, auth, 'PNG Upload Test');
    createdTemplates.push(templateId);

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/upload-background`)
      .set(auth)
      .attach('file', PNG_1x1, { filename: 'test.png', contentType: 'image/png' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.url).toMatch(/^\/uploads\/document-templates\/[a-f0-9]{24}\/[a-f0-9-]{36}\.png$/);
    expect(res.body.backgroundImage).toHaveLength(1);
    expect(res.body.backgroundImage[0]).toBe(res.body.url);
  });

  it('POST upload-background with invalid MIME (text/plain) → 400', async () => {
    const templateId = await createTestTemplate(app, auth, 'BadMime Upload Test');
    createdTemplates.push(templateId);

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/upload-background`)
      .set(auth)
      .attach('file', Buffer.from('hello'), {
        filename: 'test.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(400);
  });

  it('POST upload-background with file > 5MB → 413', async () => {
    const templateId = await createTestTemplate(app, auth, 'LargeFile Upload Test');
    createdTemplates.push(templateId);

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/upload-background`)
      .set(auth)
      .attach('file', PNG_TOO_LARGE, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
  });

  it('POST upload-background to non-existent template → 404', async () => {
    const fakeId = new Types.ObjectId().toString();
    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${fakeId}/upload-background`)
      .set(auth)
      .attach('file', PNG_1x1, { filename: 'test.png', contentType: 'image/png' });
    // service.findById() throws NotFoundException → 404.
    // The multer buffer is held in memory but the file is never written
    // (404 is thrown BEFORE the fs.writeFile call).
    expect(res.status).toBe(404);
  });

  it('POST upload-background 6th time on same template → 409 (5-image cap)', async () => {
    const templateId = await createTestTemplate(app, auth, '5Cap Upload Test');
    createdTemplates.push(templateId);

    // Upload 5 valid PNGs (all should succeed).
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .post(`/api/document-templates/${templateId}/upload-background`)
        .set(auth)
        .attach('file', PNG_1x1, { filename: `bg-${i}.png`, contentType: 'image/png' });
      expect([200, 201]).toContain(res.status);
      expect(res.body.backgroundImage).toHaveLength(i + 1);
    }

    // 6th upload should be rejected with 409 Conflict.
    const sixth = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/upload-background`)
      .set(auth)
      .attach('file', PNG_1x1, { filename: 'bg-6.png', contentType: 'image/png' });
    expect(sixth.status).toBe(409);
  });
});
