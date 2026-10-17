/**
 * TZ-DOC-STUDIO-2003 — DocumentTemplate findAll org isolation.
 *
 * Coverage:
 *  - Org-scoped user sees only templates belonging to their organization
 *  - Client-supplied ?organizationId= is ignored (no cross-org leak)
 *  - System admin (null organizationId) sees templates from all orgs
 *
 * Run: `pnpm test:e2e test/e2e/document-templates-org-scope.e2e-spec.ts`
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types, type Model } from 'mongoose';
import { createTestApp, TestContext } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';
import { TEST_ADMIN_PASSWORD } from '../setup/admin.fixture';
import {
  Organization,
  OrganizationDocument,
} from '../../src/modules/organization/organization.schema';

function templateOrgId(doc: { organizationId: unknown }): string {
  const org = doc.organizationId;
  if (typeof org === 'string') return org;
  if (org && typeof org === 'object' && '_id' in org) {
    return String((org as { _id: unknown })._id);
  }
  return String(org ?? '');
}

describe('DocumentTemplates org scope (e2e, TZ-DOC-STUDIO-2003)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let adminAuth: { Authorization: string };
  let connection: Connection;
  let orgModel: Model<OrganizationDocument>;
  const createdTemplates: string[] = [];
  const createdOrgs: string[] = [];
  let orgAId: string;
  let orgBId: string;
  let templateAId: string;
  let templateBId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    connection = app.get<Connection>(getConnectionToken());
    orgModel = connection.model<OrganizationDocument>(Organization.name);
    const { access } = await loginAsAdmin(app);
    adminAuth = authHeader(access);

    orgAId = await createOrganization('Org Scope A');
    orgBId = await createOrganization('Org Scope B');
    templateAId = await createTemplate('Template Org A', orgAId);
    templateBId = await createTemplate('Template Org B', orgBId);
  });

  afterAll(async () => {
    for (const id of createdTemplates) {
      await request(app.getHttpServer())
        .delete(`/api/document-templates/${id}`)
        .set(adminAuth)
        .catch(() => undefined);
    }
    for (const id of createdOrgs) {
      await orgModel
        .deleteOne({ _id: new Types.ObjectId(id) })
        .exec()
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
    const check = (s % 11) % 10;
    return base + check.toString();
  }

  async function createOrganization(name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/organizations')
      .set(adminAuth)
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

  async function createTemplate(name: string, orgId: string): Promise<string> {
    const docTypeId = new Types.ObjectId().toString();
    const res = await request(app.getHttpServer())
      .post('/api/document-templates')
      .set(adminAuth)
      .send({
        name,
        organizationId: orgId,
        docTypeId,
        pageSize: 'A4',
      });
    expect([200, 201]).toContain(res.status);
    createdTemplates.push(res.body._id);
    return res.body._id;
  }

  async function loginOrgUser(username: string, orgId: string): Promise<string> {
    const createRes = await request(app.getHttpServer())
      .post('/api/users')
      .set(adminAuth)
      .send({
        username,
        email: `${username}@example.com`,
        displayName: username,
        password: 'password123',
        role: 'manager',
      });
    expect(createRes.status).toBe(201);

    await connection
      .collection('users')
      .updateOne(
        { username },
        { $set: { organizationId: new Types.ObjectId(orgId) } },
      );

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password: 'password123' });
    expect([200, 201]).toContain(loginRes.status);
    return loginRes.body.access as string;
  }

  it('org-scoped user sees only templates from their organization', async () => {
    const token = await loginOrgUser(`orgscope_a_${Date.now()}`, orgAId);
    const res = await request(app.getHttpServer())
      .get('/api/document-templates')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const ids = res.body.map((t: { _id: string }) => t._id);
    expect(ids).toContain(templateAId);
    expect(ids).not.toContain(templateBId);
    for (const doc of res.body) {
      expect(templateOrgId(doc)).toBe(orgAId);
    }
  });

  it('org-scoped user cannot bypass scope via ?organizationId= query', async () => {
    const token = await loginOrgUser(`orgscope_bypass_${Date.now()}`, orgAId);
    const res = await request(app.getHttpServer())
      .get(`/api/document-templates?organizationId=${orgBId}`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const ids = res.body.map((t: { _id: string }) => t._id);
    expect(ids).not.toContain(templateBId);
    for (const doc of res.body) {
      expect(templateOrgId(doc)).toBe(orgAId);
    }
  });

  it('system admin sees templates from all organizations', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        username: process.env.ADMIN_USERNAME ?? 'admin',
        password: TEST_ADMIN_PASSWORD,
      });
    expect([200, 201]).toContain(loginRes.status);

    const res = await request(app.getHttpServer())
      .get('/api/document-templates')
      .set(authHeader(loginRes.body.access as string));
    expect(res.status).toBe(200);

    const ids = res.body.map((t: { _id: string }) => t._id);
    expect(ids).toContain(templateAId);
    expect(ids).toContain(templateBId);
  });
});
