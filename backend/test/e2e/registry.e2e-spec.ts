/**
 * TZ-86 Phase F.1.4 — Registry e2e.
 *
 * Coverage:
 *  - GET /api/registry/data-sources — returns 200 with sources envelope
 *  - lists the 7 supported data sources (including quotation and invoice)
 *  - each source has key, label, group, fields[]
 *  - each field has key, label, type ∈ {text, number, currency, date, bool}
 *  - organization source has name (text) + vatRate (number)
 *  - product source has listPrice (currency)
 *  - work-type source has hourlyRate (currency)
 *
 * Run: `pnpm test:e2e test/e2e/registry.e2e-spec.ts`
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

describe('Registry (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let auth: { Authorization: string };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const { access } = await loginAsAdmin(app);
    auth = authHeader(access);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('GET /registry/data-sources — returns 200 with sources envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/registry/data-sources')
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sources');
    expect(Array.isArray(res.body.sources)).toBe(true);
  });

  it('lists all supported data sources', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/registry/data-sources')
      .set(auth);
    expect(res.status).toBe(200);
    const keys: string[] = res.body.sources
      .map((s: { key: string }) => s.key)
      .sort();
    expect(keys).toEqual([
      'counterparty',
      'invoice',
      'material',
      'organization',
      'product',
      'quotation',
      'work-type',
    ]);
  });

  it('each source has key, label, group, fields[]', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/registry/data-sources')
      .set(auth);
    for (const src of res.body.sources) {
      expect(typeof src.key).toBe('string');
      expect(src.key.length).toBeGreaterThan(0);
      expect(typeof src.label).toBe('string');
      expect(src.label.length).toBeGreaterThan(0);
      expect(['contacts', 'catalog', 'work']).toContain(src.group);
      expect(Array.isArray(src.fields)).toBe(true);
      expect(src.fields.length).toBeGreaterThan(0);
    }
  });

  it('each field has key, label, type ∈ {text, number, currency, date, bool}', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/registry/data-sources')
      .set(auth);
    const validTypes = new Set(['text', 'number', 'currency', 'date', 'bool']);
    for (const src of res.body.sources) {
      for (const f of src.fields) {
        expect(typeof f.key).toBe('string');
        expect(f.key.length).toBeGreaterThan(0);
        expect(typeof f.label).toBe('string');
        expect(f.label.length).toBeGreaterThan(0);
        expect(validTypes.has(f.type)).toBe(true);
      }
    }
  });

  it('organization source has name (text) + vatRate (number)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/registry/data-sources')
      .set(auth);
    const org = res.body.sources.find(
      (s: { key: string }) => s.key === 'organization',
    );
    expect(org).toBeDefined();
    const nameField = org.fields.find((f: { key: string }) => f.key === 'name');
    expect(nameField?.type).toBe('text');
    const vatField = org.fields.find(
      (f: { key: string }) => f.key === 'vatRate',
    );
    expect(vatField?.type).toBe('number');
  });

  it('product source has listPrice (currency)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/registry/data-sources')
      .set(auth);
    const product = res.body.sources.find(
      (s: { key: string }) => s.key === 'product',
    );
    expect(product).toBeDefined();
    const listPrice = product.fields.find(
      (f: { key: string }) => f.key === 'listPrice',
    );
    expect(listPrice?.type).toBe('currency');
  });

  it('product source exposes schema-backed print fields and a photo slot', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/registry/data-sources')
      .set(auth);
    const product = res.body.sources.find(
      (s: { key: string }) => s.key === 'product',
    );
    expect(product).toBeDefined();
    const fields = Object.fromEntries(
      product.fields.map((f: { key: string; type: string }) => [f.key, f.type]),
    );
    expect(fields).toEqual(
      expect.objectContaining({
        notes: 'text',
        status: 'text',
        ralCode: 'text',
        'dimensions.length': 'number',
        'dimensions.width': 'number',
        'dimensions.height': 'number',
        purpose: 'text',
        installation: 'text',
        isActive: 'bool',
        hasPassport: 'bool',
        hasDrawing: 'bool',
        photoIds: 'text',
      }),
    );
  });

  it('work-type source has hourlyRate (currency)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/registry/data-sources')
      .set(auth);
    const workType = res.body.sources.find(
      (s: { key: string }) => s.key === 'work-type',
    );
    expect(workType).toBeDefined();
    const hourlyRate = workType.fields.find(
      (f: { key: string }) => f.key === 'hourlyRate',
    );
    expect(hourlyRate?.type).toBe('currency');
  });
});
