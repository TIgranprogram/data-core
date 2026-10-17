/**
 * Generated documents e2e — persist HTML snapshots from templates.
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, TestContext } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

describe('GeneratedDocuments (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let auth: { Authorization: string };
  const createdTemplates: string[] = [];
  const createdDocs: string[] = [];
  const createdOrgs: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const { access } = await loginAsAdmin(app);
    auth = authHeader(access);
  });

  afterAll(async () => {
    for (const id of createdDocs) {
      await request(app.getHttpServer())
        .delete(`/api/generated-documents/${id}`)
        .set(auth)
        .catch(() => undefined);
    }
    for (const id of createdTemplates) {
      await request(app.getHttpServer())
        .delete(`/api/document-templates/${id}`)
        .set(auth)
        .catch(() => undefined);
    }
    for (const id of createdOrgs) {
      await request(app.getHttpServer())
        .delete(`/api/organizations/${id}`)
        .set(auth)
        .catch(() => undefined);
    }
    await ctx.cleanup();
  });

  let innCounter = 0;
  function generateValidInn(): string {
    const seed = (innCounter++).toString();
    const base = (Date.now().toString().slice(-8) + seed).slice(0, 9);
    const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
    let s = 0;
    for (let i = 0; i < 9; i++) s += Number(base[i]) * w[i];
    return base + ((s % 11) % 10).toString();
  }

  async function createOrg(name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/organizations')
      .set(auth)
      .send({
        name,
        shortName: name.slice(0, 12),
        inn: generateValidInn(),
        legalForm: 'ООО',
        legalType: 'ooo',
        isActive: true,
      });
    expect([200, 201]).toContain(res.status);
    createdOrgs.push(res.body._id);
    return res.body._id;
  }

  it('POST /generated-documents/from-template/:id — persists HTML snapshot', async () => {
    const orgId = await createOrg('GenDoc Org');
    const docTypeId = new Types.ObjectId().toString();
    const tpl = await request(app.getHttpServer())
      .post('/api/document-templates')
      .set(auth)
      .send({ name: 'GenDoc Template', organizationId: orgId, docTypeId, pageSize: 'A4' });
    expect([200, 201]).toContain(tpl.status);
    const templateId = tpl.body._id;
    createdTemplates.push(templateId);

    await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/blocks`)
      .set(auth)
      .send({ type: 'text', order: 0, content: 'SNAPSHOT_MARKER_XYZ' });

    const gen = await request(app.getHttpServer())
      .post(`/api/generated-documents/from-template/${templateId}`)
      .set(auth)
      .send({ organizationId: orgId, name: 'Test snapshot' });
    expect([200, 201]).toContain(gen.status);
    expect(gen.body.number).toMatch(/^DOC-/);
    expect(gen.body.html).toContain('SNAPSHOT_MARKER_XYZ');
    createdDocs.push(gen.body._id);

    const list = await request(app.getHttpServer())
      .get('/api/generated-documents')
      .set(auth);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.some((d: { _id: string }) => d._id === gen.body._id)).toBe(true);

    const html = await request(app.getHttpServer())
      .get(`/api/generated-documents/${gen.body._id}/html`)
      .set(auth);
    expect(html.status).toBe(200);
    expect(html.text).toContain('SNAPSHOT_MARKER_XYZ');
  });
});
