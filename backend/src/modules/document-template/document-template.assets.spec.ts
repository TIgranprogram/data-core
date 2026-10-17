import { Types } from 'mongoose';
import { DocumentTemplateService } from './document-template.service';
import { DocumentRenderService } from '../document-render/document-render.service';

const TEMPLATE_ID = new Types.ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa');
const ORG_ID = new Types.ObjectId('bbbbbbbbbbbbbbbbbbbbbbbb');
const COUNTERPARTY_ID = new Types.ObjectId('cccccccccccccccccccccccc');
const QUOTATION_ID = new Types.ObjectId('dddddddddddddddddddddddd');
const ORDER_ID = new Types.ObjectId('eeeeeeeeeeeeeeeeeeeeeeee');

function lookup<T>(value: T) {
  return {
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function templateQuery(template: Record<string, unknown>) {
  return {
    populate: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(template),
  };
}

function makeService(options: {
  organization: Record<string, unknown>;
  counterparty?: Record<string, unknown>;
  quotation?: Record<string, unknown>;
  order?: Record<string, unknown>;
  blocks: Record<string, unknown>[];
  tableTemplate?: Record<string, unknown>;
}) {
  const template = {
    _id: TEMPLATE_ID,
    name: 'КП / договор',
    organizationId: ORG_ID,
    backgroundImage: [],
    defaultBackgroundIndex: -1,
    backgroundOpacity: 0.3,
    orientation: 'portrait',
  };
  const model = {
    findById: jest.fn().mockReturnValue(templateQuery(template)),
  };
  const blockModel = {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(options.blocks),
    }),
  };
  const quotationModel = {
    findById: jest.fn().mockReturnValue(lookup(options.quotation ?? null)),
  };
  const contractModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const orderModel = {
    findById: jest.fn().mockReturnValue(lookup(options.order ?? null)),
  };
  const orgModel = {
    findById: jest.fn().mockReturnValue(lookup(options.organization)),
    findOne: jest.fn().mockReturnValue(lookup(null)),
  };
  const counterpartyModel = {
    findById: jest.fn().mockReturnValue(lookup(options.counterparty ?? null)),
  };
  const productModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const materialModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const workTypeModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const textBlockModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const invoiceModel = { findById: jest.fn().mockReturnValue(lookup(null)) };

  const service = new DocumentTemplateService(
    model as never,
    blockModel as never,
    quotationModel as never,
    contractModel as never,
    orderModel as never,
    orgModel as never,
    counterpartyModel as never,
    productModel as never,
    materialModel as never,
    workTypeModel as never,
    textBlockModel as never,
    {} as never,
    (options.tableTemplate ?? {}) as never,
    {} as never,
    {} as never,
    new DocumentRenderService(),
    invoiceModel as never,
  );
  return service;
}

describe('DocumentTemplateService print bindings (TZ-ORG-ASSETS-302)', () => {
  it('renders organization requisites, vault logo/signature, and quotation/counterparty data', async () => {
    const service = makeService({
      organization: {
        _id: ORG_ID,
        name: 'KPPDF ООО',
        inn: '7701234567',
        legalAddress: 'г. Москва, ул. Примерная, 1',
        assets: [
          { role: 'logo', storageUrl: '/uploads/org/logo.png' },
          { role: 'signature', storageUrl: '/uploads/org/signature.png' },
        ],
      },
      counterparty: {
        _id: COUNTERPARTY_ID,
        name: 'ООО Заказчик',
        organizationId: ORG_ID,
      },
      quotation: {
        _id: QUOTATION_ID,
        number: 'QTN-2026-001',
        organizationId: ORG_ID,
        counterpartyId: COUNTERPARTY_ID,
      },
      blocks: [
        {
          type: 'image',
          height: 80,
          dataBinding: { source: 'organization', field: 'logoUrl' },
        },
        {
          type: 'signature',
          dataBinding: { source: 'organization', field: 'signatureUrl' },
        },
        {
          type: 'text',
          dataBinding: { source: 'organization', field: 'legalAddress' },
        },
        {
          type: 'text',
          dataBinding: { source: 'quotation', field: 'number' },
        },
        {
          type: 'text',
          dataBinding: { source: 'counterparty', field: 'name' },
        },
      ],
    });

    const html = await service.build(TEMPLATE_ID.toString(), {
      quotationId: QUOTATION_ID.toString(),
    });

    expect(html).toContain('src="/uploads/org/logo.png"');
    expect(html).toContain('src="/uploads/org/signature.png"');
    expect(html).toContain('<base href="http://127.0.0.1:3000/">');
    expect(html).toContain('г. Москва, ул. Примерная, 1');
    expect(html).toContain('QTN-2026-001');
    expect(html).toContain('ООО Заказчик');
  });

  it('renders an order and its stub quotation without vault assets and does not crash', async () => {
    const service = makeService({
      organization: {
        _id: ORG_ID,
        name: 'KPPDF ООО',
        legalAddress: 'г. Москва',
        assets: [],
      },
      counterparty: {
        _id: COUNTERPARTY_ID,
        name: 'ООО Заказчик',
        organizationId: ORG_ID,
      },
      quotation: {
        _id: QUOTATION_ID,
        number: 'QTN-STUB-001',
        organizationId: ORG_ID,
        counterpartyId: COUNTERPARTY_ID,
      },
      order: {
        _id: ORDER_ID,
        counterpartyId: COUNTERPARTY_ID,
        quotationId: QUOTATION_ID,
        items: [],
      },
      blocks: [
        {
          type: 'image',
          height: 80,
          dataBinding: { source: 'organization', field: 'logoUrl' },
        },
        {
          type: 'signature',
          dataBinding: { source: 'organization', field: 'signatureUrl' },
        },
        {
          type: 'text',
          dataBinding: { source: 'quotation', field: 'number' },
        },
      ],
    });

    const html = await service.build(TEMPLATE_ID.toString(), {
      orderId: ORDER_ID.toString(),
    });

    expect(html).toContain('QTN-STUB-001');
    expect(html).toContain('height:80px');
    expect(html).not.toContain('src="/uploads/org/');
    expect(html).toContain('Подпись: ___________________');
  });

  it('renders 30 positions across configured pages with repeated headers and one footer', async () => {
    const tableTemplate = {
      findById: jest.fn().mockResolvedValue({
        columns: [
          {
            key: 'productName',
            label: 'Наименование',
            type: 'text',
            align: 'left',
          },
        ],
      }),
      preview: jest.fn(
        (
          _id: string,
          rows: unknown[][],
          _layout: unknown,
          totals?: { total: number },
        ) =>
          `<table><thead><tr><th>Наименование</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${String(typeof row[0] === 'object' && row[0] !== null ? (row[0] as { title?: unknown }).title : row[0])}</td></tr>`).join('')}</tbody></table>${totals ? '<div class="pi-deal-totals">Итого</div>' : ''}`,
      ),
    };
    const service = makeService({
      organization: { _id: ORG_ID, name: 'KPPDF ООО', assets: [] },
      tableTemplate,
      blocks: [
        {
          _id: 'table-block',
          type: 'table',
          settings: { tableTemplateId: 'table-1', kpLineItems: true },
        },
      ],
    });

    const html = await service.build(TEMPLATE_ID.toString(), {
      previewLines: Array.from({ length: 30 }, (_, index) => ({
        productName: `Позиция ${index + 1}`,
        quantity: 1,
        unitPrice: 100,
      })),
      sheetLayout: { rowsFirstPage: 4, rowsNextPage: 6 },
      dealTotals: { vatPercent: 20 },
    });

    expect((html.match(/class="doc-page"/g) ?? []).length).toBe(6);
    expect((html.match(/<thead>/g) ?? []).length).toBe(6);
    expect((html.match(/pi-deal-totals/g) ?? []).length).toBe(1);
    expect(html).toContain('Позиция 30');
  });

  it('maps a persisted product photo into the live table image cell and keeps empty photos blank (TZ-NX-DOCSTUDIO-TABLE-PHOTO-EMPTY-BLANK)', async () => {
    const tableTemplate = {
      findById: jest.fn().mockResolvedValue({
        columns: [{ key: 'photo', label: 'Фото', type: 'text', align: 'center' }],
      }),
      preview: jest.fn((_id: string, rows: unknown[][]) => {
        const cell = rows[0]?.[0] as { kind?: string; url?: string } | undefined;
        return cell?.kind === 'image' && cell.url ? `<img src="${cell.url}" alt="" />` : '';
      }),
    };
    const service = makeService({
      organization: { _id: ORG_ID, name: 'KPPDF ООО', assets: [] },
      tableTemplate,
      blocks: [
        {
          _id: 'table-block',
          type: 'table',
          settings: { tableTemplateId: 'table-1', kpLineItems: true },
        },
      ],
    });

    const withPhoto = await service.build(TEMPLATE_ID.toString(), {
      previewLines: [
        { productName: 'Стенд', quantity: 1, unitPrice: 100, photoUrl: '/uploads/stand.webp' },
      ],
      tableLayout: [{ key: 'photo', visible: true }],
      sheetLayout: { showPhotoColumn: true },
    });
    expect(withPhoto).toContain('<img src="/uploads/stand.webp" alt="" />');

    const withoutPhoto = await service.build(TEMPLATE_ID.toString(), {
      previewLines: [{ productName: 'Без фото', quantity: 1, unitPrice: 100 }],
      tableLayout: [{ key: 'photo', visible: true }],
      sheetLayout: { showPhotoColumn: true },
    });
    expect(withoutPhoto).not.toContain('Нет фото');
    expect(withoutPhoto).not.toContain('<img');
    expect(withoutPhoto).not.toContain('pi-photo-empty');
  });

  it('renders КП terms with values and preserves unknown variables', async () => {
    const service = makeService({
      organization: { _id: ORG_ID, name: 'KPPDF ООО', assets: [] },
      blocks: [{ type: 'text', settings: { role: 'terms' } }],
    });

    const html = await service.build(TEMPLATE_ID.toString(), {
      terms: [
        {
          text: 'КП {{kp_number}} на сумму {{total_price}}; {{unknown_token}}',
          sortOrder: 0,
        },
      ],
      proposalNumber: 'QTN-2026-009',
      proposalDate: '2026-08-11T00:00:00.000Z',
      totalPrice: 12345.67,
    });

    expect(html).toContain('QTN-2026-009');
    expect(html).toContain('12');
    expect(html).toContain('{{unknown_token}}');
    expect(html).not.toContain('undefined');
  });

  it('splits more pages for a short table frame when rowsFirst/Next are 0 (TZ-SALES-376)', async () => {
    const tableTemplate = {
      findById: jest.fn().mockResolvedValue({
        columns: [{ key: 'productName', label: 'Наименование', type: 'text', align: 'left' }],
      }),
      preview: jest.fn((_id: string, rows: unknown[][]) =>
        `<table><tbody>${rows.map((row) => `<tr><td>${String((row[0] as { title?: unknown })?.title ?? row[0])}</td></tr>`).join('')}</tbody></table>`,
      ),
    };
    const lines = Array.from({ length: 24 }, (_, index) => ({
      productName: `Позиция ${index + 1}`,
      quantity: 1,
      unitPrice: 100,
    }));
    const shortFrameBlocks = [
      {
        _id: 'table-block',
        type: 'table',
        settings: { tableTemplateId: 'table-1', kpLineItems: true },
        layout: { page: 1, x: 0.08, y: 0.2, width: 0.84, height: 0.15, zIndex: 1, rotation: 0 },
      },
    ];
    const tallFrameBlocks = [
      {
        ...shortFrameBlocks[0],
        layout: { page: 1, x: 0.08, y: 0.1, width: 0.84, height: 0.75, zIndex: 1, rotation: 0 },
      },
    ];

    const shortService = makeService({
      organization: { _id: ORG_ID, name: 'KPPDF ООО', assets: [] },
      tableTemplate,
      blocks: shortFrameBlocks,
    });
    const tallService = makeService({
      organization: { _id: ORG_ID, name: 'KPPDF ООО', assets: [] },
      tableTemplate,
      blocks: tallFrameBlocks,
    });

    const shortHtml = await shortService.build(TEMPLATE_ID.toString(), {
      previewLines: lines,
      sheetLayout: { rowsFirstPage: 0, rowsNextPage: 0 },
    });
    const tallHtml = await tallService.build(TEMPLATE_ID.toString(), {
      previewLines: lines,
      sheetLayout: { rowsFirstPage: 0, rowsNextPage: 0 },
    });

    const shortPages = (shortHtml.match(/class="doc-page"/g) ?? []).length;
    const tallPages = (tallHtml.match(/class="doc-page"/g) ?? []).length;
    expect(shortPages).toBeGreaterThan(tallPages);
    expect(shortPages).toBeGreaterThanOrEqual(2);
  });

  it('honors pageBreakBefore as a hard page cut (TZ-SALES-376)', async () => {
    const tableTemplate = {
      findById: jest.fn().mockResolvedValue({
        columns: [{ key: 'productName', label: 'Наименование', type: 'text', align: 'left' }],
      }),
      preview: jest.fn((_id: string, rows: unknown[][]) =>
        `<table><tbody>${rows.map((row) => `<tr><td>${String((row[0] as { title?: unknown })?.title ?? row[0])}</td></tr>`).join('')}</tbody></table>`,
      ),
    };
    const service = makeService({
      organization: { _id: ORG_ID, name: 'KPPDF ООО', assets: [] },
      tableTemplate,
      blocks: [
        {
          _id: 'table-block',
          type: 'table',
          settings: { tableTemplateId: 'table-1', kpLineItems: true },
          layout: { page: 1, x: 0.08, y: 0.2, width: 0.84, height: 0.75, zIndex: 1, rotation: 0 },
        },
      ],
    });

    const html = await service.build(TEMPLATE_ID.toString(), {
      previewLines: [
        { productName: 'A', quantity: 1, unitPrice: 100 },
        { productName: 'B', quantity: 1, unitPrice: 100 },
        { productName: 'C', quantity: 1, unitPrice: 100, rowPresentation: { pageBreakBefore: true } },
        { productName: 'D', quantity: 1, unitPrice: 100 },
      ],
      sheetLayout: { rowsFirstPage: 10, rowsNextPage: 10 },
    });

    expect((html.match(/class="doc-page"/g) ?? []).length).toBe(2);
    const pageBodies = html.split('class="doc-page"').slice(1);
    expect(pageBodies[0]).toContain('>A<');
    expect(pageBodies[0]).toContain('>B<');
    expect(pageBodies[0]).not.toContain('>C<');
    expect(pageBodies[1]).toContain('>C<');
  });

  it('renders last-page deal totals from the full KP, not the page slice (TZ-SALES-376)', async () => {
    let capturedTotals: { total?: number } | undefined;
    const tableTemplate = {
      findById: jest.fn().mockResolvedValue({
        columns: [{ key: 'productName', label: 'Наименование', type: 'text', align: 'left' }],
      }),
      preview: jest.fn(
        (
          _id: string,
          rows: unknown[][],
          _layout: unknown,
          totals?: { total: number },
        ) => {
          if (totals) capturedTotals = totals;
          return `<table><tbody>${rows.length} rows</tbody></table>${totals ? `<div class="pi-deal-totals">${totals.total}</div>` : ''}`;
        },
      ),
    };
    const service = makeService({
      organization: { _id: ORG_ID, name: 'KPPDF ООО', assets: [] },
      tableTemplate,
      blocks: [
        {
          _id: 'table-block',
          type: 'table',
          settings: { tableTemplateId: 'table-1', kpLineItems: true },
        },
      ],
    });

    await service.build(TEMPLATE_ID.toString(), {
      previewLines: [
        { productName: 'A', quantity: 1, unitPrice: 100 },
        { productName: 'B', quantity: 2, unitPrice: 50 },
        { productName: 'C', quantity: 1, unitPrice: 200 },
      ],
      sheetLayout: { rowsFirstPage: 1, rowsNextPage: 1 },
      dealTotals: { vatPercent: 20 },
    });

    expect(capturedTotals?.total).toBe(400);
  });

  it('clips positioned table blocks in build HTML (TZ-SALES-376)', async () => {
    const tableTemplate = {
      findById: jest.fn().mockResolvedValue({
        columns: [{ key: 'productName', label: 'Наименование', type: 'text', align: 'left' }],
      }),
      preview: jest.fn(() => '<table><tbody><tr><td>x</td></tr></tbody></table>'),
    };
    const service = makeService({
      organization: { _id: ORG_ID, name: 'KPPDF ООО', assets: [] },
      tableTemplate,
      blocks: [
        {
          _id: 'table-block',
          type: 'table',
          settings: { tableTemplateId: 'table-1', kpLineItems: true },
          layout: { page: 1, x: 0.08, y: 0.2, width: 0.84, height: 0.3, zIndex: 1, rotation: 0 },
        },
      ],
    });

    const html = await service.build(TEMPLATE_ID.toString(), {
      previewLines: [{ productName: 'A', quantity: 1, unitPrice: 100 }],
    });

    expect(html).toContain('block--positioned block--table');
    expect(html).toContain('.block--positioned.block--table { overflow: hidden; }');
  });

  it('hoists multipage outer CSS for background and positioned blocks (TZ-SALES-378)', async () => {
    const tableTemplate = {
      findById: jest.fn().mockResolvedValue({
        columns: [{ key: 'productName', label: 'Наименование', type: 'text', align: 'left' }],
      }),
      preview: jest.fn((_id: string, rows: unknown[][]) =>
        `<table><tbody>${rows.map((row) => `<tr><td>${String((row[0] as { title?: unknown })?.title ?? row[0])}</td></tr>`).join('')}</tbody></table>`,
      ),
    };
    const service = makeService({
      organization: { _id: ORG_ID, name: 'KPPDF ООО', assets: [] },
      tableTemplate,
      blocks: [
        {
          _id: 'table-block',
          type: 'table',
          settings: { tableTemplateId: 'table-1', kpLineItems: true },
          layout: { page: 1, x: 0.08, y: 0.2, width: 0.84, height: 0.15, zIndex: 1, rotation: 0 },
        },
      ],
    });

    const lines = Array.from({ length: 12 }, (_, index) => ({
      productName: `Позиция ${index + 1}`,
      quantity: 1,
      unitPrice: 100,
    }));

    const html = await service.build(TEMPLATE_ID.toString(), {
      previewLines: lines,
      sheetLayout: { rowsFirstPage: 0, rowsNextPage: 0 },
    });

    expect((html.match(/class="doc-page"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toMatch(/\.doc-bg\s*\{\s*position:\s*absolute/);
    expect(html).toContain('.doc-page{position:relative');
    expect(html).toContain('.block--positioned.block--table { overflow: hidden; }');
  });

  it('auto next-page capacity exceeds short first-page frame (TZ-SALES-378)', async () => {
    const tableTemplate = {
      findById: jest.fn().mockResolvedValue({
        columns: [{ key: 'productName', label: 'Наименование', type: 'text', align: 'left' }],
      }),
      preview: jest.fn((_id: string, rows: unknown[][]) =>
        `<table><tbody>${rows.map((row) => `<tr><td>${String((row[0] as { title?: unknown })?.title ?? row[0])}</td></tr>`).join('')}</tbody></table>`,
      ),
    };
    const shortFrameBlocks = [
      {
        _id: 'table-block',
        type: 'table',
        settings: { tableTemplateId: 'table-1', kpLineItems: true },
        layout: { page: 1, x: 0.08, y: 0.2, width: 0.84, height: 0.15, zIndex: 1, rotation: 0 },
      },
    ];
    const service = makeService({
      organization: { _id: ORG_ID, name: 'KPPDF ООО', assets: [] },
      tableTemplate,
      blocks: shortFrameBlocks,
    });

    const manyLines = Array.from({ length: 30 }, (_, index) => ({
      productName: `Позиция ${index + 1}`,
      quantity: 1,
      unitPrice: 100,
    }));

    const autoHtml = await service.build(TEMPLATE_ID.toString(), {
      previewLines: manyLines,
      sheetLayout: { rowsFirstPage: 0, rowsNextPage: 0 },
    });

    expect((autoHtml.match(/class="doc-page"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    const autoPageBodies = autoHtml.split('class="doc-page"').slice(1);
    const rowsOnFirstPage = (autoPageBodies[0].match(/Позиция/g) ?? []).length;
    const rowsOnSecondPage = (autoPageBodies[1].match(/Позиция/g) ?? []).length;
    expect(rowsOnSecondPage).toBeGreaterThan(rowsOnFirstPage);
  });

  it('remaps continuation table block to full-page geometry (TZ-SALES-378)', async () => {
    const tableTemplate = {
      findById: jest.fn().mockResolvedValue({
        columns: [{ key: 'productName', label: 'Наименование', type: 'text', align: 'left' }],
      }),
      preview: jest.fn((_id: string, rows: unknown[][]) =>
        `<table><tbody>${rows.map((row) => `<tr><td>${String((row[0] as { title?: unknown })?.title ?? row[0])}</td></tr>`).join('')}</tbody></table>`,
      ),
    };
    const service = makeService({
      organization: { _id: ORG_ID, name: 'KPPDF ООО', assets: [] },
      tableTemplate,
      blocks: [
        {
          _id: 'table-block',
          type: 'table',
          settings: { tableTemplateId: 'table-1', kpLineItems: true },
          layout: { page: 1, x: 0.08, y: 0.2, width: 0.84, height: 0.15, zIndex: 1, rotation: 0 },
        },
      ],
    });

    const html = await service.build(TEMPLATE_ID.toString(), {
      previewLines: Array.from({ length: 10 }, (_, index) => ({
        productName: `Позиция ${index + 1}`,
        quantity: 1,
        unitPrice: 100,
      })),
      sheetLayout: { rowsFirstPage: 2, rowsNextPage: 8 },
    });

    const pageBodies = html.split('class="doc-page"').slice(1);
    expect(pageBodies.length).toBeGreaterThanOrEqual(2);
    expect(pageBodies[0]).toMatch(/top:20%/);
    expect(pageBodies[0]).toMatch(/height:15%/);
    expect(pageBodies[1]).toMatch(/top:0%/);
    expect(pageBodies[1]).toMatch(/height:100%/);
  });
});
