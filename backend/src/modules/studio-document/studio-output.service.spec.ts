import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Types } from 'mongoose';
import { DocumentRenderService } from '../document-render/document-render.service';
import { BLANK_A4_TEMPLATE_NAME } from '../document-template/blank-a4-template.constants';
import { StudioOutputService } from './studio-output.service';

const DOC_ID = new Types.ObjectId().toString();
const TEMPLATE_ID = new Types.ObjectId();
const ORG_ID = new Types.ObjectId();
const BLOCK_ID = new Types.ObjectId();

function studioDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(DOC_ID),
    name: 'Studio KP',
    organizationId: ORG_ID,
    sourceTemplateId: TEMPLATE_ID,
    pageSize: 'A4',
    orientation: 'portrait',
    backgroundImage: [],
    defaultBackgroundIndex: -1,
    backgroundOpacity: 0.3,
    pageNumbering: false,
    revision: 3,
    status: 'draft',
    context: {},
    dataSets: [],
    ...overrides,
  };
}

function tableBlock() {
  return {
    _id: BLOCK_ID,
    type: 'table',
    order: 1,
    content: '',
    isActive: true,
    showLine: false,
    settings: {
      tableTemplateColumns: [
        { key: 'name', label: 'Наименование' },
        { key: 'qty', label: 'Кол-во' },
        { key: 'price', label: 'Цена' },
      ],
    },
    layout: { page: 1, x: 0.1, y: 0.3, width: 0.8, zIndex: 1, rotation: 0 },
  };
}

function createOutputService(deps: {
  studioService: Record<string, jest.Mock>;
  blockService?: Record<string, jest.Mock>;
  dataResolver?: Record<string, jest.Mock>;
  generatedDocuments?: Record<string, jest.Mock>;
  templateService?: Record<string, jest.Mock>;
}) {
  const renderService = new DocumentRenderService();
  const dataResolver = deps.dataResolver ?? {
    resolveDataSets: jest.fn().mockImplementation(async (_doc, _blocks, useLive) => {
      if (!useLive) {
        return [{ key: `table-${BLOCK_ID.toString()}`, rows: [['Frozen', '1', '10']] }];
      }
      return [{ key: `table-${BLOCK_ID.toString()}`, rows: [['Live', '2', '20']] }];
    }),
    resolveOrganizationVatRate: jest.fn().mockResolvedValue(20),
    bakeSnapshot: jest.fn().mockResolvedValue([
      {
        key: `table-${BLOCK_ID.toString()}`,
        source: { type: 'manual', bakedFrom: 'quotation-items' },
        rows: [['Baked', '1', '100']],
      },
    ]),
  };
  return new StudioOutputService(
    deps.studioService as never,
    (deps.blockService ?? {
      findAllByStudioDocument: jest.fn().mockResolvedValue([tableBlock()]),
    }) as never,
    renderService,
    (deps.generatedDocuments ?? { archiveStudio: jest.fn() }) as never,
    { renderHtmlToPdf: jest.fn() } as never,
    dataResolver as never,
    (deps.templateService ?? { ensureBlankA4Sentinel: jest.fn() }) as never,
  );
}

describe('StudioOutputService (Wave 9–10)', () => {
  it('preview returns rendered HTML and current revision', async () => {
    const doc = studioDoc();
    const studioService = {
      findById: jest.fn().mockResolvedValue(doc),
      update: jest.fn(),
    };
    const service = createOutputService({ studioService });

    const result = await service.preview(DOC_ID, { organizationId: ORG_ID.toString() });

    expect(result.revision).toBe(3);
    expect(result.html).toContain('Live');
  });

  it('preview substitutes counterparty tokens from doc.context via the hydration bag', async () => {
    const cpId = new Types.ObjectId().toString();
    const doc = studioDoc({ context: { counterpartyId: cpId } });
    const studioService = {
      findById: jest.fn().mockResolvedValue(doc),
      update: jest.fn(),
    };
    const blockService = {
      findAllByStudioDocument: jest.fn().mockResolvedValue([
        {
          _id: new Types.ObjectId().toString(),
          type: 'text',
          order: 0,
          content: '<p>Müşteri: {{counterparty.shortName}}</p>',
          isActive: true,
          showLine: false,
          layout: { page: 1, x: 0.1, y: 0.1, width: 0.8, zIndex: 1, rotation: 0 },
        },
      ]),
    };
    const templateService = {
      ensureBlankA4Sentinel: jest.fn(),
      buildSubstitutionBag: jest.fn().mockResolvedValue({
        organization: { _id: ORG_ID.toString() },
        counterparty: { name: 'Acme Ltd', shortName: 'Acme' },
      }),
    };
    const service = createOutputService({ studioService, blockService, templateService });

    const result = await service.preview(DOC_ID, { organizationId: ORG_ID.toString() });

    expect(templateService.buildSubstitutionBag).toHaveBeenCalledWith(
      expect.objectContaining({ counterpartyId: cpId, organizationId: ORG_ID.toString() }),
    );
    expect(result.html).toContain('Acme');
    expect(result.html).not.toContain('{{counterparty');
  });

  it('preview renders raw token as empty when context has no counterpartyId', async () => {
    const doc = studioDoc({ context: {} });
    const studioService = {
      findById: jest.fn().mockResolvedValue(doc),
      update: jest.fn(),
    };
    const blockService = {
      findAllByStudioDocument: jest.fn().mockResolvedValue([
        {
          _id: new Types.ObjectId().toString(),
          type: 'text',
          order: 0,
          content: '<p>Müşteri: {{counterparty.shortName}}</p>',
          isActive: true,
          showLine: false,
          layout: { page: 1, x: 0.1, y: 0.1, width: 0.8, zIndex: 1, rotation: 0 },
        },
      ]),
    };
    const templateService = {
      ensureBlankA4Sentinel: jest.fn(),
      buildSubstitutionBag: jest.fn().mockResolvedValue({
        organization: { _id: ORG_ID.toString() },
      }),
    };
    const service = createOutputService({ studioService, blockService, templateService });

    const result = await service.preview(DOC_ID, { organizationId: ORG_ID.toString() });

    expect(result.html).not.toContain('Acme');
    expect(result.html).not.toContain('{{counterparty');
  });

  it('finalize bakes snapshot, freezes, archives, then marks final', async () => {
    const doc = studioDoc({ revision: 5 });
    const frozenDoc = { ...doc, revision: 6, status: 'frozen' };
    const finalDoc = { ...frozenDoc, revision: 7, status: 'final' };
    const dataResolver = {
      resolveDataSets: jest.fn().mockResolvedValue([]),
      resolveOrganizationVatRate: jest.fn().mockResolvedValue(20),
      bakeSnapshot: jest.fn().mockResolvedValue([
        {
          key: `table-${BLOCK_ID.toString()}`,
          source: { type: 'manual' },
          rows: [['Baked', '1', '100']],
        },
      ]),
    };
    const studioService = {
      findById: jest.fn().mockResolvedValue(doc),
      update: jest
        .fn()
        .mockResolvedValueOnce(frozenDoc)
        .mockResolvedValueOnce(finalDoc),
    };
    const archived = {
      toObject: () => ({
        sourceType: 'studio',
        sourceRevision: 5,
        studioDocumentId: DOC_ID,
      }),
    };
    const generatedDocuments = {
      archiveStudio: jest.fn().mockResolvedValue(archived),
    };
    const service = createOutputService({
      studioService,
      dataResolver,
      generatedDocuments,
    });

    const result = await service.finalize(DOC_ID, {
      organizationId: ORG_ID.toString(),
      id: 'user-1',
    });

    expect(dataResolver.bakeSnapshot).toHaveBeenCalled();
    expect(studioService.update).toHaveBeenNthCalledWith(
      1,
      DOC_ID,
      expect.objectContaining({ expectedRevision: 5, status: 'frozen' }),
      ORG_ID.toString(),
      'user-1',
    );
    expect(generatedDocuments.archiveStudio).toHaveBeenCalledWith(
      expect.objectContaining({
        studioDocumentId: DOC_ID,
        sourceRevision: 5,
        templateId: TEMPLATE_ID.toString(),
      }),
    );
    expect(studioService.update).toHaveBeenNthCalledWith(
      2,
      DOC_ID,
      { expectedRevision: 6, status: 'final' },
      ORG_ID.toString(),
      'user-1',
    );
    expect(result.studioDocument.status).toBe('final');
  });

  it('preview inlines an existing local upload as a data URI (same as PDF)', async () => {
    const uploadsDir = join(process.cwd(), 'uploads', 'studio-preview-inline-test');
    const publicUrl = '/uploads/studio-preview-inline-test/sample.png';
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(join(uploadsDir, 'sample.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    try {
      const doc = studioDoc();
      const studioService = {
        findById: jest.fn().mockResolvedValue(doc),
        update: jest.fn(),
      };
      const blockService = {
        findAllByStudioDocument: jest.fn().mockResolvedValue([
          {
            _id: new Types.ObjectId().toString(),
            type: 'text',
            order: 0,
            content: `<img src="${publicUrl}" alt="">`,
            isActive: true,
            showLine: false,
            layout: { page: 1, x: 0.1, y: 0.1, width: 0.8, zIndex: 1, rotation: 0 },
          },
        ]),
      };
      const service = createOutputService({ studioService, blockService });

      const result = await service.preview(DOC_ID, { organizationId: ORG_ID.toString() });

      expect(result.html).toContain('data:image/png;base64,');
      expect(result.html).not.toContain(publicUrl);
    } finally {
      await rm(uploadsDir, { recursive: true, force: true });
    }
  });

  it('preview leaves a missing local upload as a bare /uploads/ URL', async () => {
    const missingUrl = '/uploads/studio-preview-inline-test/missing.png';
    const doc = studioDoc();
    const studioService = {
      findById: jest.fn().mockResolvedValue(doc),
      update: jest.fn(),
    };
    const blockService = {
      findAllByStudioDocument: jest.fn().mockResolvedValue([
        {
          _id: new Types.ObjectId().toString(),
          type: 'text',
          order: 0,
          content: `<img src="${missingUrl}" alt="">`,
          isActive: true,
          showLine: false,
          layout: { page: 1, x: 0.1, y: 0.1, width: 0.8, zIndex: 1, rotation: 0 },
        },
      ]),
    };
    const service = createOutputService({ studioService, blockService });

    const result = await service.preview(DOC_ID, { organizationId: ORG_ID.toString() });

    expect(result.html).toContain(missingUrl);
  });

  it('preview renders multipage HTML with page numbering', async () => {
    const doc = studioDoc({ manualPageCount: 2, pageNumbering: true });
    const blockId = new Types.ObjectId().toString();
    const studioService = {
      findById: jest.fn().mockResolvedValue(doc),
      update: jest.fn(),
    };
    const blockService = {
      findAllByStudioDocument: jest.fn().mockResolvedValue([
        {
          _id: blockId,
          type: 'text',
          order: 0,
          content: '<p>Page 1</p>',
          isActive: true,
          showLine: false,
          layout: { page: 1, x: 0.1, y: 0.1, width: 0.8, zIndex: 1, rotation: 0 },
        },
        {
          type: 'text',
          order: 1,
          content: '<p>Page 2</p>',
          isActive: true,
          showLine: false,
          layout: { page: 2, x: 0.1, y: 0.1, width: 0.8, zIndex: 1, rotation: 0 },
        },
      ]),
    };
    const service = createOutputService({ studioService, blockService });

    const result = await service.preview(DOC_ID, { organizationId: ORG_ID.toString() });

    expect(result.html).toContain('doc-page');
    expect(result.html).toContain('Page 2');
    expect(result.html).toContain('Страница 1 из 2');
  });

  it('finalize blank doc uses sentinel template and creates GeneratedDocument', async () => {
    const sentinelId = new Types.ObjectId();
    const doc = studioDoc({ sourceTemplateId: undefined, name: 'Blank A4 draft', revision: 2 });
    const frozenDoc = { ...doc, revision: 3, status: 'frozen' };
    const finalDoc = { ...frozenDoc, revision: 4, status: 'final' };
    const studioService = {
      findById: jest.fn().mockResolvedValue(doc),
      update: jest
        .fn()
        .mockResolvedValueOnce(frozenDoc)
        .mockResolvedValueOnce(finalDoc),
    };
    const templateService = {
      ensureBlankA4Sentinel: jest.fn().mockResolvedValue({
        _id: sentinelId,
        name: BLANK_A4_TEMPLATE_NAME,
      }),
    };
    const archived = {
      toObject: () => ({
        sourceType: 'studio',
        sourceRevision: 2,
        studioDocumentId: DOC_ID,
        templateId: sentinelId.toString(),
      }),
    };
    const generatedDocuments = {
      archiveStudio: jest.fn().mockResolvedValue(archived),
    };
    const service = createOutputService({
      studioService,
      templateService,
      generatedDocuments,
    });

    const result = await service.finalize(DOC_ID, {
      organizationId: ORG_ID.toString(),
      id: 'user-1',
    });

    expect(templateService.ensureBlankA4Sentinel).toHaveBeenCalledWith(ORG_ID.toString());
    expect(generatedDocuments.archiveStudio).toHaveBeenCalledWith(
      expect.objectContaining({
        studioDocumentId: DOC_ID,
        sourceRevision: 2,
        templateId: sentinelId.toString(),
        templateName: BLANK_A4_TEMPLATE_NAME,
        name: 'Blank A4 draft',
      }),
    );
    expect(result.studioDocument.status).toBe('final');
    expect(result.generatedDocument).toMatchObject({
      sourceType: 'studio',
      templateId: sentinelId.toString(),
    });
  });
});

describe('GeneratedDocument archiveStudio contract (Wave 10)', () => {
  it('writes studio provenance fields atomically', async () => {
    const { GeneratedDocumentService } = await import(
      '../generated-document/generated-document.service'
    );
    const studioId = new Types.ObjectId();
    const templateId = new Types.ObjectId();
    const orgId = new Types.ObjectId();
    const created = { _id: new Types.ObjectId() };
    const model = { create: jest.fn().mockResolvedValue(created) };
    const counter = { next: jest.fn().mockResolvedValue('SD-DEMO-2026-001') };
    const orgModel = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({ shortName: 'Demo' }),
      }),
    };
    const service = new GeneratedDocumentService(
      model as never,
      orgModel as never,
      { findById: jest.fn() } as never,
      counter as never,
    );

    await service.archiveStudio({
      studioDocumentId: studioId.toString(),
      sourceRevision: 7,
      templateId: templateId.toString(),
      name: 'Archived',
      organizationId: orgId.toString(),
      html: '<p>snap</p>',
      buildPayload: { studioDocumentId: studioId.toString() },
    });

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'studio',
        studioDocumentId: studioId,
        sourceId: studioId,
        sourceRevision: 7,
        status: 'final',
        number: 'SD-DEMO-2026-001',
      }),
    );
  });
});
