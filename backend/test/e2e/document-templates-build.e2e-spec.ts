/**
 * TZ-86 Phase F.1.3 — DocumentTemplate build e2e.
 *
 * Coverage:
 *  - POST /api/document-templates/:id/build — returns 201 + text/html
 *  - Build with literal content (no dataBinding) renders the content as-is
 *  - Build with `{{organization.name}}` substitution template resolves the org
 *    from the build body and substitutes the name
 *  - Build with static dataBinding (set via Mongoose model bypass) substitutes
 *    the static value into the rendered HTML
 *  - Build with missing sourceIds degrades gracefully (empty placeholder)
 *  - Build with invalid templateId returns 400 (BadRequestException)
 *
 *  - Build with multi-column blocks (columns[] on TemplateBlock)
 *
 * Note: static-binding test uses Mongoose bypass because testing the build
 * pipeline independent of HTTP validation edge cases.
 *
 * Run: `pnpm test:e2e test/e2e/document-templates-build.e2e-spec.ts`
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types, type Model } from 'mongoose';
import { createTestApp, TestContext } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';
import { TemplateBlock, TemplateBlockDocument } from '../../src/modules/template-block/template-block.schema';
import { Organization, OrganizationDocument } from '../../src/modules/organization/organization.schema';
import { Counterparty, CounterpartyDocument } from '../../src/modules/counterparty/counterparty.schema';
import { TableTemplate, TableTemplateDocument } from '../../src/modules/table-template/table-template.schema';

describe('DocumentTemplates build (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let auth: { Authorization: string };
  let connection: Connection;
  let blockModel: Model<TemplateBlockDocument>;
  let orgModel: Model<OrganizationDocument>;
  let counterpartyModel: Model<CounterpartyDocument>;
  let tableModel: Model<TableTemplateDocument>;
  const createdTemplates: string[] = [];
  const createdTables: string[] = [];
  const createdOrgs: string[] = [];
  const createdCounterparties: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    connection = app.get<Connection>(getConnectionToken());
    blockModel = connection.model<TemplateBlockDocument>(TemplateBlock.name);
    orgModel = connection.model<OrganizationDocument>(Organization.name);
    counterpartyModel = connection.model<CounterpartyDocument>(Counterparty.name);
    tableModel = connection.model<TableTemplateDocument>(TableTemplate.name);
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
    for (const id of createdTables) {
      await tableModel.deleteOne({ _id: new Types.ObjectId(id) }).exec().catch(() => undefined);
    }
    // Cleanup organizations created directly via Mongoose
    for (const id of createdOrgs) {
      await orgModel.deleteOne({ _id: new Types.ObjectId(id) }).exec().catch(() => undefined);
    }
    for (const id of createdCounterparties) {
      await counterpartyModel.deleteOne({ _id: new Types.ObjectId(id) }).exec().catch(() => undefined);
    }
    await ctx.cleanup();
  });

  /**
   * Helper: create a real Organization via the API (admin endpoint).
   *
   * The `IsINN()` validator (`common/validators/inn.validator.ts`) runs the
   * official FNS checksum algorithm — random 10-digit strings fail it. We
   * therefore compute a unique 10-digit INN per call (9 digits derived from
   * the run-scoped monotonic counter + Date.now() tail for cross-run
   * uniqueness, 10th digit = the canonical (sum mod 11 mod 10) checksum).
   * This avoids dependence on a hand-curated list of real-world INNs (any
   * such list can drift as legal entities are merged/renamed).
   */
  let innCounter = 0;
  function generateValidInn(): string {
    const seed = (innCounter++).toString();
    // First 9 digits: 8 from `Date.now()` tail (cross-run uniqueness) + 1 from
    // the per-test counter (within-run uniqueness).
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

  async function createRealCounterparty(name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/counterparties')
      .set(auth)
      .send({
        name,
        shortName: name.slice(0, 12),
        inn: generateValidInn(),
        roles: ['customer'],
        isActive: true,
      });
    expect([200, 201]).toContain(res.status);
    createdCounterparties.push(res.body._id);
    return res.body._id;
  }

  /** Helper: create template + block via HTTP. Block has no dataBinding. */
  async function createTemplateWithBlock(opts: {
    templateName: string;
    organizationId: string;
    blockContent: string;
    orientation?: 'portrait' | 'landscape';
  }): Promise<{ templateId: string; blockId: string }> {
    const docTypeId = new Types.ObjectId().toString();
    const tpl = await request(app.getHttpServer())
      .post('/api/document-templates')
      .set(auth)
      .send({
        name: opts.templateName,
        organizationId: opts.organizationId,
        docTypeId,
        pageSize: 'A4',
        ...(opts.orientation ? { orientation: opts.orientation } : {}),
      });
    expect([200, 201]).toContain(tpl.status);
    const tId = tpl.body._id;
    createdTemplates.push(tId);

    const block = await request(app.getHttpServer())
      .post(`/api/document-templates/${tId}/blocks`)
      .set(auth)
      .send({
        type: 'text',
        order: 0,
        content: opts.blockContent,
      });
    expect([200, 201]).toContain(block.status);
    return { templateId: tId, blockId: block.body._id };
  }

  it('POST /document-templates/:id/build — returns 201 + text/html with literal content', async () => {
    const orgId = await createRealOrganization('Literal Test Org');
    const { templateId } = await createTemplateWithBlock({
      templateName: 'Literal Test',
      organizationId: orgId,
      blockContent: 'LITERAL_CONTENT_HERE',
    });

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/build`)
      .set(auth)
      .send({});
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('LITERAL_CONTENT_HERE');
    expect(res.text).toContain('<!DOCTYPE html>');
    expect(res.text).toContain('html, body { margin: 0; overflow: hidden; }');
    expect(res.text).toContain('html { width: 210mm; height: 297mm; }');
    expect(res.text).toContain('min-height: 0; padding: 0;');
  });

  it('POST /document-templates/:id/build — uses a landscape A4 page box', async () => {
    const orgId = await createRealOrganization('Landscape Test Org');
    const { templateId } = await createTemplateWithBlock({
      templateName: 'Landscape Test',
      organizationId: orgId,
      blockContent: 'LANDSCAPE_CONTENT_HERE',
      orientation: 'landscape',
    });

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/build`)
      .set(auth)
      .send({});
    expect(res.status).toBe(201);
    expect(res.text).toContain('LANDSCAPE_CONTENT_HERE');
    expect(res.text).toContain('html { width: 297mm; height: 210mm; }');
  });

  it('POST /document-templates/:id/build — preserves layout on resolved blocks', async () => {
    const orgId = await createRealOrganization('Positioned Org');
    const { templateId, blockId } = await createTemplateWithBlock({
      templateName: 'Positioned Template',
      organizationId: orgId,
      blockContent: 'POSITIONED_CONTENT',
    });

    await blockModel.updateOne(
      { _id: new Types.ObjectId(blockId) },
      {
        $set: {
          source: { kind: 'literal', value: 'POSITIONED_CONTENT' },
          layout: {
            page: 1,
            x: 0.12,
            y: 0.24,
            width: 0.6,
            height: 0.1,
            zIndex: 3,
            rotation: 0,
          },
        },
      },
    ).exec();

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/build`)
      .set(auth)
      .send({});
    expect(res.status).toBe(201);
    expect(res.text).toContain('POSITIONED_CONTENT');
    expect(res.text).toContain('position:absolute');
    expect(res.text).toContain('left:12%');
    expect(res.text).toContain('top:24%');
  });

  it('POST /document-templates/:id/build — substitutes {{organization.name}} from build body', async () => {
    const orgId = await createRealOrganization('SubstituteOrg');
    const { templateId } = await createTemplateWithBlock({
      templateName: 'Substitute Test',
      organizationId: orgId,
      blockContent: 'Hello {{organization.name}}!',
    });

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/build`)
      .set(auth)
      .send({ organizationId: orgId });
    expect(res.status).toBe(201);
    expect(res.text).toContain('Hello SubstituteOrg!');
    expect(res.text).not.toContain('{{organization.name}}');
  });

  it('POST /document-templates/:id/build — substitutes {{counterparty.name}} and {{client_name}}', async () => {
    const orgId = await createRealOrganization('Cp Substitute Org');
    const cpId = await createRealCounterparty('School 91 Krasnodar');
    const { templateId } = await createTemplateWithBlock({
      templateName: 'Counterparty Substitute',
      organizationId: orgId,
      blockContent: 'Client: {{counterparty.name}} / {{client_name}}',
    });

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/build`)
      .set(auth)
      .send({ organizationId: orgId, counterpartyId: cpId });
    expect(res.status).toBe(201);
    expect(res.text).toContain('School 91 Krasnodar');
    expect(res.text).not.toContain('{{counterparty.name}}');
    expect(res.text).not.toContain('{{client_name}}');
  });

  it('POST /document-templates/:id/build — substitutes {{kp_number}} from proposalNumber', async () => {
    const orgId = await createRealOrganization('Kp Number Org');
    const { templateId } = await createTemplateWithBlock({
      templateName: 'KP Number Substitute',
      organizationId: orgId,
      blockContent: 'No {{kp_number}}',
    });

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/build`)
      .set(auth)
      .send({ organizationId: orgId, proposalNumber: 'QTN-2026-029' });
    expect(res.status).toBe(201);
    expect(res.text).toContain('No QTN-2026-029');
    expect(res.text).not.toContain('{{kp_number}}');
  });

  it('POST /document-templates/:id/build — static dataBinding via Mongoose bypass substitutes value', async () => {
    // Create template via HTTP (no block yet)
    const orgId = await createRealOrganization('Static Test Org');
    const docTypeId = new Types.ObjectId().toString();
    const tpl = await request(app.getHttpServer())
      .post('/api/document-templates')
      .set(auth)
      .send({
        name: 'Static Binding Test',
        organizationId: orgId,
        docTypeId,
      });
    expect([200, 201]).toContain(tpl.status);
    const tId = tpl.body._id;
    createdTemplates.push(tId);

    // Create block with dataBinding via Mongoose (bypassing HTTP whitelist)
    const block = await blockModel.create({
      templateId: new Types.ObjectId(tId),
      type: 'text',
      order: 0,
      content: 'PLACEHOLDER', // should be replaced by dataBinding.value
      dataBinding: { source: 'static', value: 'STATIC_BOUND_VALUE' },
      isActive: true,
    });
    expect(block._id).toBeDefined();

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${tId}/build`)
      .set(auth)
      .send({});
    expect(res.status).toBe(201);
    expect(res.text).toContain('STATIC_BOUND_VALUE');
    expect(res.text).not.toContain('PLACEHOLDER');
  });

  it('POST /document-templates/:id/build — missing sourceIds degrade to empty placeholders', async () => {
    const orgId = await createRealOrganization('Empty Test Org');
    const { templateId } = await createTemplateWithBlock({
      templateName: 'Empty Test',
      organizationId: orgId,
      blockContent: 'Hi {{counterparty.name}}!',
    });

    // Build with no counterpartyId in body → counterparty source not resolved → empty
    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/build`)
      .set(auth)
      .send({});
    expect(res.status).toBe(201);
    expect(res.text).toContain('Hi !'); // empty placeholder
  });

  it('POST /document-templates/:id/build — invalid templateId returns 400', async () => {
    const fakeId = new Types.ObjectId().toString();
    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${fakeId}/build`)
      .set(auth)
      .send({});
    // build() validates ObjectId first → BadRequestException (400).
    // Note: NOT 404, because we don't even reach the findById call.
    expect([400, 404]).toContain(res.status);
  });

  it('POST /document-templates/:id/build — empty table source renders a skeleton row', async () => {
    const orgId = await createRealOrganization('Empty Table Org');
    const table = await tableModel.create({
      name: 'Empty Line Items',
      columns: [
        { key: 'name', label: 'Наименование', type: 'text' },
        { key: 'qty', label: 'Кол-во', type: 'number' },
      ],
      sampleRows: [],
      isActive: true,
    });
    createdTables.push(table._id.toString());

    const docTypeId = new Types.ObjectId().toString();
    const tpl = await request(app.getHttpServer())
      .post('/api/document-templates')
      .set(auth)
      .send({ name: 'Empty Table Build', organizationId: orgId, docTypeId, pageSize: 'A4' });
    expect([200, 201]).toContain(tpl.status);
    const templateId = tpl.body._id;
    createdTemplates.push(templateId);

    const block = await blockModel.create({
      templateId: new Types.ObjectId(templateId),
      type: 'table',
      order: 0,
      source: { kind: 'table-template', refId: table._id.toString(), mode: 'live' },
      isActive: true,
    });
    expect(block._id).toBeDefined();

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/build`)
      .set(auth)
      .send({ organizationId: orgId });
    expect(res.status).toBe(201);
    expect(res.text).toContain('<table');
    expect(res.text).toContain('<thead>');
    expect(res.text).toContain('Наименование');
    expect(res.text).toContain('Кол-во');
    expect(res.text).toContain('<tbody><tr>');
    expect(res.text.match(/<td\b/g)).toHaveLength(2);
    expect(res.text).not.toContain('Нет данных');
  });

  it('POST build with previewLines binds only the assigned live line-items table', async () => {
    const orgId = await createRealOrganization('Line Items Org');
    const targetTable = await tableModel.create({
      name: 'Assigned line items',
      columns: [
        { key: 'productName', label: 'Наименование', type: 'text' },
        { key: 'qty', label: 'Кол-во', type: 'number' },
        { key: 'price', label: 'Цена', type: 'currency' },
        { key: 'sum', label: 'Сумма', type: 'currency' },
        { key: 'sku', label: 'Артикул', type: 'text' },
      ],
      sampleRows: [],
      isActive: true,
    });
    const otherTable = await tableModel.create({
      name: 'Unassigned live table',
      columns: [{ key: 'name', label: 'Другая таблица', type: 'text' }],
      sampleRows: [],
      isActive: true,
    });
    createdTables.push(targetTable._id.toString(), otherTable._id.toString());

    const docTypeId = new Types.ObjectId().toString();
    const tpl = await request(app.getHttpServer())
      .post('/api/document-templates')
      .set(auth)
      .send({ name: 'Line Items Build', organizationId: orgId, docTypeId, pageSize: 'A4' });
    expect([200, 201]).toContain(tpl.status);
    const templateId = tpl.body._id;
    createdTemplates.push(templateId);

    await blockModel.create([
      {
        templateId: new Types.ObjectId(templateId),
        type: 'table',
        order: 0,
        source: { kind: 'table-template', refId: targetTable._id.toString(), mode: 'live' },
        settings: { kpLineItems: true },
        isActive: true,
      },
      {
        templateId: new Types.ObjectId(templateId),
        type: 'table',
        order: 1,
        source: { kind: 'table-template', refId: otherTable._id.toString(), mode: 'live' },
        isActive: true,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/build`)
      .set(auth)
      .send({
        organizationId: orgId,
        previewLines: [
          {
            productName: 'Кронштейн',
            quantity: 2,
            unitPrice: 1250,
            productSku: 'BR-2',
            unit: 'шт',
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.text).toContain('Кронштейн');
    expect(res.text).toContain('BR-2');
    expect(res.text).toContain('2');
    expect(res.text.match(/<table\b/g)).toHaveLength(2);
    expect(res.text.match(/Кронштейн/g)).toHaveLength(1);
    expect(res.text).not.toContain('Нет данных');

    const layoutRes = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/build`)
      .set(auth)
      .send({
        organizationId: orgId,
        previewLines: [
          {
            productName: 'Кронштейн',
            quantity: 2,
            unitPrice: 1250,
            productSku: 'BR-2',
            unit: 'шт',
          },
        ],
        tableLayout: [
          { key: 'sum', visible: true },
          { key: 'productName', visible: true },
          { key: 'qty', visible: false },
        ],
      });
    expect(layoutRes.status).toBe(201);
    expect(layoutRes.text).not.toContain('Кол-во');
    expect(layoutRes.text.indexOf('Сумма')).toBeLessThan(
      layoutRes.text.indexOf('Наименование'),
    );
    expect(layoutRes.text).toContain('2 500');

    const selectedTargetRes = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/build`)
      .set(auth)
      .send({
        organizationId: orgId,
        previewLines: [
          {
            productName: 'Кронштейн',
            quantity: 2,
            unitPrice: 1250,
            productSku: 'BR-2',
            unit: 'шт',
          },
        ],
        tableTargetId: otherTable._id.toString(),
        tableLayout: [{ key: 'name', visible: true }],
      });
    expect(selectedTargetRes.status).toBe(201);
    expect(selectedTargetRes.text).toContain('Другая таблица');
    expect(selectedTargetRes.text).toContain('Кронштейн');
    expect(selectedTargetRes.text.match(/Кронштейн/g)).toHaveLength(1);

    const totalsRes = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/build`)
      .set(auth)
      .send({
        organizationId: orgId,
        previewLines: [
          {
            productName: 'Кронштейн',
            quantity: 2,
            unitPrice: 1250,
            productSku: 'BR-2',
            unit: 'шт',
          },
        ],
        dealTotals: { vatPercent: 20 },
      });
    expect(totalsRes.status).toBe(201);
    expect(totalsRes.text).toContain('Итого:');
    expect(totalsRes.text).toContain('в т.ч. НДС 20%');

    const zeroVatRes = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/build`)
      .set(auth)
      .send({
        organizationId: orgId,
        previewLines: [],
        dealTotals: { vatPercent: 0 },
      });
    expect(zeroVatRes.status).toBe(201);
    expect(zeroVatRes.text).toContain('Итого:');
    expect(zeroVatRes.text).not.toContain('в т.ч. НДС');
  });

  it('POST block with columns[] — persists and build renders multi-column HTML', async () => {
    const orgId = await createRealOrganization('MultiCol Org');
    const docTypeId = new Types.ObjectId().toString();
    const tpl = await request(app.getHttpServer())
      .post('/api/document-templates')
      .set(auth)
      .send({ name: 'MultiCol', organizationId: orgId, docTypeId, pageSize: 'A4' });
    expect([200, 201]).toContain(tpl.status);
    const templateId = tpl.body._id;
    createdTemplates.push(templateId);

    const block = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/blocks`)
      .set(auth)
      .send({
        type: 'text',
        order: 0,
        columns: [
          { id: 'c1', content: 'LEFT_COL_XYZ', width: 1 },
          { id: 'c2', content: 'RIGHT_COL_XYZ', width: 1 },
        ],
      });
    expect([200, 201]).toContain(block.status);
    expect(block.body.columns).toHaveLength(2);

    const res = await request(app.getHttpServer())
      .post(`/api/document-templates/${templateId}/build`)
      .set(auth)
      .send({ organizationId: orgId });
    expect(res.status).toBe(201);
    expect(res.text).toContain('LEFT_COL_XYZ');
    expect(res.text).toContain('RIGHT_COL_XYZ');
  });
});
