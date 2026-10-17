/**
 * TZ-DOC-311 — DocumentTemplate property persistence e2e.
 *
 * Coverage:
 *  - POST /api/document-templates with `pageNumbering` → 201, field persisted
 *  - PATCH /api/document-templates/:id with `{ pageNumbering: true }` → 2xx
 *    and the value is returned + persisted (re-fetch via GET)
 *  - PATCH with `{ pageNumbering: false }` → 2xx, value toggles off
 *  - PATCH with unsupported fields (`headerText`, `tableOfContents`,
 *    `footerText`) never persists them — they are stripped by the global
 *    ValidationPipe whitelist (400 in production where
 *    forbidNonWhitelisted is on) — proves the builder UI must NOT send them
 *  - A legacy template created WITHOUT the new fields still opens (GET 200)
 *
 * Run: `pnpm test:e2e test/e2e/document-templates-props.e2e-spec.ts`
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types, type Model } from 'mongoose';
import { createTestApp, TestContext } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';
import { Organization, OrganizationDocument } from '../../src/modules/organization/organization.schema';

describe('DocumentTemplates property persistence (e2e, TZ-DOC-311)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let auth: { Authorization: string };
  let connection: Connection;
  let orgModel: Model<OrganizationDocument>;
  const createdTemplates: string[] = [];
  const createdOrgs: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    connection = app.get<Connection>(getConnectionToken());
    orgModel = connection.model<OrganizationDocument>(Organization.name);
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
    for (const id of createdOrgs) {
      await orgModel.deleteOne({ _id: new Types.ObjectId(id) }).exec().catch(() => undefined);
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
    const check = (s % 11) % 10;
    return base + check.toString();
  }

  async function createRealOrganization(name: string): Promise<string> {
    const inn = generateValidInn();
    const res = await request(app.getHttpServer())
      .post('/api/organizations')
      .set(auth)
      .send({
        name,
        shortName: name.slice(0, 12),
        inn,
        legalForm: 'ООО',
        legalType: 'ooo',
        isActive: true,
      });
    expect([200, 201]).toContain(res.status);
    createdOrgs.push(res.body._id);
    return res.body._id;
  }

  async function createTemplate(name: string, extra: Record<string, unknown> = {}): Promise<string> {
    const orgId = await createRealOrganization(`Org ${name}`);
    const docTypeId = new Types.ObjectId().toString();
    const res = await request(app.getHttpServer())
      .post('/api/document-templates')
      .set(auth)
      .send({
        name,
        organizationId: orgId,
        docTypeId,
        pageSize: 'A4',
        ...extra,
      });
    expect([200, 201]).toContain(res.status);
    createdTemplates.push(res.body._id);
    return res.body._id;
  }

  it('POST accepts pageNumbering and persists it', async () => {
    const id = await createTemplate('Props POST', { pageNumbering: true });

    const got = await request(app.getHttpServer())
      .get(`/api/document-templates/${id}`)
      .set(auth);
    expect(got.status).toBe(200);
    expect(got.body.pageNumbering).toBe(true);
  });

  it('PATCH pageNumbering=true returns 2xx and persists after reload', async () => {
    const id = await createTemplate('Props PATCH on');

    const patched = await request(app.getHttpServer())
      .patch(`/api/document-templates/${id}`)
      .set(auth)
      .send({ pageNumbering: true });
    expect([200, 201]).toContain(patched.status);
    expect(patched.body.pageNumbering).toBe(true);

    const reloaded = await request(app.getHttpServer())
      .get(`/api/document-templates/${id}`)
      .set(auth);
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.pageNumbering).toBe(true);
  });

  it('PATCH pageNumbering=false toggles the value off', async () => {
    const id = await createTemplate('Props PATCH off', { pageNumbering: true });

    const patched = await request(app.getHttpServer())
      .patch(`/api/document-templates/${id}`)
      .set(auth)
      .send({ pageNumbering: false });
    expect([200, 201]).toContain(patched.status);
    expect(patched.body.pageNumbering).toBe(false);
  });

  it('unsupported legacy fields (headerText / tableOfContents / footerText) are NOT persisted', async () => {
    // Contract: these fields are NOT part of the DTO. The global
    // ValidationPipe (`whitelist: true`) strips them before the service.
    // In production (`forbidNonWhitelisted: true` in main.ts) they are
    // rejected with 400; in the test harness they are silently stripped —
    // either way they must never reach the persisted document.
    const id = await createTemplate('Props unsupported');

    for (const payload of [
      { headerText: 'Шапка' },
      { footerText: 'Подвал' },
      { tableOfContents: true },
    ]) {
      const res = await request(app.getHttpServer())
        .patch(`/api/document-templates/${id}`)
        .set(auth)
        .send(payload);
      // Test harness ValidationPipe strips unknowns → 200 with no error.
      expect(res.status).toBe(200);
    }

    const got = await request(app.getHttpServer())
      .get(`/api/document-templates/${id}`)
      .set(auth);
    expect(got.status).toBe(200);
    // Schema defaults remain untouched — the sent values were stripped.
    expect(got.body.headerText).toBe('');
    expect(got.body.footerText).toBe('');
    expect(got.body.tableOfContents).toBe(false);
  });

  it('legacy template without the new fields still opens (GET 200, defaults)', async () => {
    const id = await createTemplate('Props legacy');

    const got = await request(app.getHttpServer())
      .get(`/api/document-templates/${id}`)
      .set(auth);
    expect(got.status).toBe(200);
    expect(got.body.pageNumbering).toBe(false);
  });
});
