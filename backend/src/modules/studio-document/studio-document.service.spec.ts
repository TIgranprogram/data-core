import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import {
  STUDIO_DOCUMENT_REVISION_CONFLICT,
  StudioDocumentService,
} from './studio-document.service';

const ORG_A = new Types.ObjectId().toString();
const ORG_B = new Types.ObjectId().toString();
const DOC_ID = new Types.ObjectId().toString();
const USER_ID = new Types.ObjectId().toString();

function mockQuery<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function studioDoc(overrides: Record<string, unknown> = {}) {
  const updatedAt = new Date('2026-08-28T10:00:00.000Z');
  return {
    _id: new Types.ObjectId(DOC_ID),
    name: 'Test doc',
    organizationId: new Types.ObjectId(ORG_A),
    pageSize: 'A4',
    orientation: 'portrait',
    backgroundImage: [],
    defaultBackgroundIndex: -1,
    backgroundOpacity: 0.3,
    pageNumbering: false,
    manualPageCount: 1,
    context: {},
    dataAnchors: [],
    dataSets: [],
    status: 'draft',
    revision: 1,
    schemaVersion: 1,
    updatedAt,
    save: jest.fn().mockImplementation(function (this: unknown) {
      return Promise.resolve(this);
    }),
    ...overrides,
  };
}

function createService(fallbackOrgId: Types.ObjectId | null = null) {
  const model = {
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    deleteOne: jest.fn(),
  };
  const orgModel = {
    findOne: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(
        fallbackOrgId ? { _id: fallbackOrgId } : null,
      ),
    }),
  };
  const templateService = {
    findById: jest.fn(),
    create: jest.fn(),
  };
  const blockService = {
    cloneBlocksFromTemplate: jest.fn().mockResolvedValue([]),
    cloneBlocksFromStudioDocument: jest.fn().mockResolvedValue([]),
    cloneBlocksToTemplate: jest.fn().mockResolvedValue([]),
    deleteAllByStudioDocument: jest.fn().mockResolvedValue(0),
    createForStudioDocument: jest.fn(),
    updateLayoutsForStudioDocument: jest.fn(),
    reorderForStudioDocument: jest.fn(),
    findAllByStudioDocument: jest.fn().mockResolvedValue([]),
  };
  const dataResolver = {
    resolveDataSets: jest.fn().mockResolvedValue([]),
  };
  const organizationService = {
    findById: jest.fn(),
  };
  return {
    service: new StudioDocumentService(
      model as never,
      orgModel as never,
      templateService as never,
      blockService as never,
      dataResolver as never,
      organizationService as never,
    ),
    model: model as {
      create: jest.Mock;
      find: jest.Mock;
      findById: jest.Mock;
      deleteOne: jest.Mock;
    },
    orgModel,
    templateService,
    blockService,
    dataResolver,
    organizationService,
  };
}

describe('StudioDocumentService (TZ-DOC-STUDIO-201b)', () => {
  describe('create', () => {
    it('creates an org-scoped document with defaults', async () => {
      const { service, model } = createService();
      const doc = studioDoc();
      model.create.mockResolvedValue(doc);

      const result = await service.create({ name: 'KP draft' }, ORG_A, USER_ID);

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'KP draft',
          organizationId: new Types.ObjectId(ORG_A),
          status: 'draft',
          revision: 1,
          schemaVersion: 1,
          manualPageCount: 1,
          createdBy: new Types.ObjectId(USER_ID),
          updatedBy: new Types.ObjectId(USER_ID),
        }),
      );
      expect(result).toBe(doc);
    });

    it('allows create without docTypeId', async () => {
      const { service, model } = createService();
      model.create.mockResolvedValue(studioDoc());

      await service.create({ name: 'Empty A4' }, ORG_A);

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ docTypeId: undefined }),
      );
    });

    it('rejects create when auth has no organizationId and no org exists', async () => {
      const { service } = createService(null);

      await expect(
        service.create({ name: 'No org' }, null),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('falls back to first organization when user has no organizationId', async () => {
      const fallbackOrg = new Types.ObjectId();
      const { service, model } = createService(fallbackOrg);
      model.create.mockResolvedValue(studioDoc({ organizationId: fallbackOrg }));

      await service.create({ name: 'Admin draft' }, null);

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: fallbackOrg,
        }),
      );
    });
  });

  describe('findAll', () => {
    it('lists documents filtered by organizationId', async () => {
      const { service, model } = createService();
      model.find.mockReturnValue(mockQuery([studioDoc()]));

      await service.findAll(ORG_A);

      expect(model.find).toHaveBeenCalledWith({
        organizationId: new Types.ObjectId(ORG_A),
      });
    });

    it('an unscoped/admin caller (organizationId=null) lists every document, not just the fallback org (TZ-NX-DOCSTUDIO-UNSCOPED-ORG-SCOPE)', async () => {
      const { service, model } = createService();
      model.find.mockReturnValue(mockQuery([studioDoc(), studioDoc({ organizationId: new Types.ObjectId(ORG_B) })]));

      await service.findAll(null);

      expect(model.find).toHaveBeenCalledWith();
    });
  });

  describe('findById', () => {
    it('returns document in same org scope', async () => {
      const { service, model } = createService();
      const doc = studioDoc();
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      const result = await service.findById(DOC_ID, ORG_A);
      expect(result).toBe(doc);
    });

    it('rejects foreign org with 403', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(studioDoc()),
      });

      await expect(service.findById(DOC_ID, ORG_B)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('returns 404 for missing document', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(service.findById(DOC_ID, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('an unscoped/admin caller (organizationId=null) loads any document by id, regardless of its org (TZ-NX-DOCSTUDIO-UNSCOPED-ORG-SCOPE)', async () => {
      const { service, model } = createService();
      const doc = studioDoc({ organizationId: new Types.ObjectId(ORG_B) });
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      const result = await service.findById(DOC_ID, null);
      expect(result).toBe(doc);
    });
  });

  describe('update', () => {
    it('applies patch and increments revision on expectedRevision match', async () => {
      const { service, model } = createService();
      const doc = studioDoc({ revision: 2 });
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      const result = await service.update(
        DOC_ID,
        { expectedRevision: 2, name: 'Renamed' },
        ORG_A,
        USER_ID,
      );

      expect(doc.name).toBe('Renamed');
      expect(doc.revision).toBe(3);
      expect(doc.save).toHaveBeenCalled();
      expect(result).toBe(doc);
    });

    it('returns 409 STUDIO_DOCUMENT_REVISION_CONFLICT on stale revision', async () => {
      const { service, model } = createService();
      const doc = studioDoc({ revision: 5 });
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      await expect(
        service.update(DOC_ID, { expectedRevision: 3, name: 'Stale' }, ORG_A),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: STUDIO_DOCUMENT_REVISION_CONFLICT,
          revision: 5,
          updatedAt: doc.updatedAt,
        }),
      });
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('requires docTypeId when transitioning to final', async () => {
      const { service, model } = createService();
      const doc = studioDoc({ revision: 1, docTypeId: undefined });
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      await expect(
        service.update(
          DOC_ID,
          { expectedRevision: 1, status: 'final' },
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows final transition when docTypeId exists on document', async () => {
      const { service, model } = createService();
      const docTypeId = new Types.ObjectId();
      const doc = studioDoc({
        revision: 1,
        docTypeId,
        status: 'draft',
      });
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      await service.update(
        DOC_ID,
        { expectedRevision: 1, status: 'final' },
        ORG_A,
      );

      expect(doc.status).toBe('final');
      expect(doc.revision).toBe(2);
    });

    describe('organizationId — «Исполнитель» (TZ-NX-DOCSTUDIO-ISSUER-SELECT)', () => {
      it('an unscoped/admin caller (organizationId=null) may switch the issuer to any existing org', async () => {
        // fallback org (ORG_A) is only needed so resolveOrganizationId's own
        // internal fallback lookup (used for the document's *scope* check,
        // unrelated to the new issuer pick below) has something to resolve to.
        const { service, model, organizationService } = createService(new Types.ObjectId(ORG_A));
        const doc = studioDoc({ revision: 1 });
        model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });
        organizationService.findById.mockResolvedValue({ _id: ORG_B });

        await service.update(DOC_ID, { expectedRevision: 1, organizationId: ORG_B }, null);

        expect(organizationService.findById).toHaveBeenCalledWith(ORG_B, { organizationId: null });
        expect(String(doc.organizationId)).toBe(ORG_B);
        expect(doc.revision).toBe(2);
      });

      it('a caller bound to their own org cannot switch the issuer to a different org (same IDOR policy as OrganizationService)', async () => {
        const { service, model, organizationService } = createService();
        const doc = studioDoc({ revision: 1, organizationId: new Types.ObjectId(ORG_A) });
        model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });
        organizationService.findById.mockRejectedValue(new NotFoundException(`Organization ${ORG_B} not found`));

        await expect(
          service.update(DOC_ID, { expectedRevision: 1, organizationId: ORG_B }, ORG_A),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(doc.save).not.toHaveBeenCalled();
        expect(String(doc.organizationId)).toBe(ORG_A);
      });

      it('a bound caller may re-select their own org (no-op-equivalent, still a valid pick)', async () => {
        const { service, model, organizationService } = createService();
        const doc = studioDoc({ revision: 1, organizationId: new Types.ObjectId(ORG_A) });
        model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });
        organizationService.findById.mockResolvedValue({ _id: ORG_A });

        await service.update(DOC_ID, { expectedRevision: 1, organizationId: ORG_A }, ORG_A);

        expect(organizationService.findById).toHaveBeenCalledWith(ORG_A, { organizationId: ORG_A });
        expect(String(doc.organizationId)).toBe(ORG_A);
        expect(doc.revision).toBe(2);
      });

      it('leaves organizationId untouched when the field is omitted from the patch', async () => {
        const { service, model, organizationService } = createService();
        const doc = studioDoc({ revision: 1, organizationId: new Types.ObjectId(ORG_A) });
        model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

        await service.update(DOC_ID, { expectedRevision: 1, name: 'Untouched issuer' }, ORG_A);

        expect(organizationService.findById).not.toHaveBeenCalled();
        expect(String(doc.organizationId)).toBe(ORG_A);
      });

      it('does not self-lockout: unscoped admin who switches the issuer away from the fallback org can still addBlock on the same doc (TZ-NX-DOCSTUDIO-UNSCOPED-ORG-SCOPE regression)', async () => {
        // Reproduces the ISSUER-SELECT evidence: doc starts in the
        // alphabetical-first fallback org (ORG_A); an unscoped admin
        // (organizationId=null) switches the issuer to ORG_B, then
        // immediately does "+ Фото" on the same doc. Before this fix,
        // findById re-resolved the caller's own scope to the ORG_A
        // fallback and asserted the document (now ORG_B) against it —
        // a 403 self-lockout on every request after the switch.
        const { service, model, organizationService, blockService } = createService(
          new Types.ObjectId(ORG_A),
        );
        const doc = studioDoc({ revision: 1, organizationId: new Types.ObjectId(ORG_A) });
        model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });
        organizationService.findById.mockResolvedValue({ _id: ORG_B });

        await service.update(DOC_ID, { expectedRevision: 1, organizationId: ORG_B }, null);
        expect(String(doc.organizationId)).toBe(ORG_B);

        const created = { _id: new Types.ObjectId(), type: 'image', order: 0 };
        blockService.createForStudioDocument.mockResolvedValue(created);

        const block = await service.addBlock(
          DOC_ID,
          doc.revision,
          { type: 'image', order: 0 } as never,
          null,
        );
        expect(block).toBe(created);
      });
    });
  });

  describe('putDataSet (TZ-DOC-STUDIO-701)', () => {
    it('upserts dataSet by key and increments revision', async () => {
      const { service, model } = createService();
      const doc = studioDoc({
        revision: 2,
        dataSets: [{ key: 'items', source: { type: 'manual' }, rows: [] }],
      });
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      const result = await service.putDataSet(
        DOC_ID,
        'items',
        {
          expectedRevision: 2,
          dataSet: { source: { type: 'manual' }, rows: [['a']] },
        },
        ORG_A,
        USER_ID,
      );

      expect(doc.dataSets).toEqual([
        { key: 'items', source: { type: 'manual' }, rows: [['a']] },
      ]);
      expect(doc.revision).toBe(3);
      expect(doc.save).toHaveBeenCalled();
      expect(result).toBe(doc);
    });

    it('appends new dataSet when key is missing', async () => {
      const { service, model } = createService();
      const doc = studioDoc({ revision: 1, dataSets: [] });
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      await service.putDataSet(
        DOC_ID,
        'table-main',
        {
          expectedRevision: 1,
          dataSet: { source: { type: 'manual' }, rows: [] },
        },
        ORG_A,
      );

      expect(doc.dataSets).toEqual([
        { key: 'table-main', source: { type: 'manual' }, rows: [] },
      ]);
      expect(doc.revision).toBe(2);
    });

    it('returns 409 on stale expectedRevision', async () => {
      const { service, model } = createService();
      const doc = studioDoc({ revision: 4, dataSets: [] });
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      await expect(
        service.putDataSet(
          DOC_ID,
          'items',
          { expectedRevision: 2, dataSet: { rows: [] } },
          ORG_A,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: STUDIO_DOCUMENT_REVISION_CONFLICT,
          revision: 4,
        }),
      });
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('hydrates live rows in the response for catalog-products source', async () => {
      const { service, model, blockService, dataResolver } = createService();
      const doc = studioDoc({ revision: 1, dataSets: [] });
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });
      const blocks = [{ _id: new Types.ObjectId(), type: 'table' }];
      blockService.findAllByStudioDocument.mockResolvedValue(blocks);
      dataResolver.resolveDataSets.mockResolvedValue([
        {
          key: 'table-1',
          source: { type: 'catalog-products' },
          rows: [
            ['Product A', '1', '100'],
            ['Product B', '1', '200'],
          ],
        },
      ]);

      const result = await service.putDataSet(
        DOC_ID,
        'table-1',
        {
          expectedRevision: 1,
          dataSet: { source: { type: 'catalog-products' }, rows: [] },
        },
        ORG_A,
      );

      expect(blockService.findAllByStudioDocument).toHaveBeenCalledWith(DOC_ID);
      expect(dataResolver.resolveDataSets).toHaveBeenCalledWith(doc, blocks, true);
      expect(result.dataSets).toEqual([
        {
          key: 'table-1',
          source: { type: 'catalog-products' },
          rows: [
            ['Product A', '1', '100'],
            ['Product B', '1', '200'],
          ],
        },
      ]);
    });

    it('hydrates to empty rows when catalog selection is empty', async () => {
      const { service, model, blockService, dataResolver } = createService();
      const doc = studioDoc({ revision: 1, dataSets: [] });
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });
      blockService.findAllByStudioDocument.mockResolvedValue([]);
      dataResolver.resolveDataSets.mockResolvedValue([
        { key: 'table-1', source: { type: 'catalog-products' }, rows: [] },
      ]);

      const result = await service.putDataSet(
        DOC_ID,
        'table-1',
        {
          expectedRevision: 1,
          dataSet: { source: { type: 'catalog-products' }, rows: [] },
        },
        ORG_A,
      );

      expect(result.dataSets).toEqual([
        { key: 'table-1', source: { type: 'catalog-products' }, rows: [] },
      ]);
    });

    it('does not hydrate manual sources (no resolver call)', async () => {
      const { service, model, blockService, dataResolver } = createService();
      const doc = studioDoc({ revision: 1, dataSets: [] });
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      await service.putDataSet(
        DOC_ID,
        'items',
        { expectedRevision: 1, dataSet: { source: { type: 'manual' }, rows: [['x']] } },
        ORG_A,
      );

      expect(blockService.findAllByStudioDocument).not.toHaveBeenCalled();
      expect(dataResolver.resolveDataSets).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes document in org scope and cascades blocks', async () => {
      const { service, model, blockService } = createService();
      const doc = studioDoc();
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });
      model.deleteOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 1 }) });
      blockService.deleteAllByStudioDocument.mockResolvedValue(2);

      await service.remove(DOC_ID, ORG_A);

      expect(blockService.deleteAllByStudioDocument).toHaveBeenCalledWith(DOC_ID);
      expect(model.deleteOne).toHaveBeenCalledWith({ _id: doc._id });
    });
  });

  describe('createFromTemplate (TZ-DOC-STUDIO-1301)', () => {
    const TEMPLATE_ID = new Types.ObjectId().toString();

    it('creates doc from template and clones blocks', async () => {
      const { service, model, templateService, blockService } = createService();
      const template = {
        _id: new Types.ObjectId(TEMPLATE_ID),
        name: 'КП шаблон',
        organizationId: new Types.ObjectId(ORG_A),
        docTypeId: new Types.ObjectId(),
        pageSize: 'A4',
        orientation: 'portrait',
        backgroundImage: ['/uploads/bg.png'],
        defaultBackgroundIndex: 0,
        backgroundOpacity: 0.5,
        pageNumbering: true,
      };
      const created = studioDoc({
        _id: new Types.ObjectId(),
        name: 'КП шаблон',
        sourceTemplateId: template._id,
      });
      templateService.findById.mockResolvedValue(template);
      model.create.mockResolvedValue(created);

      const result = await service.createFromTemplate(
        TEMPLATE_ID,
        ORG_A,
        USER_ID,
        undefined,
      );

      expect(templateService.findById).toHaveBeenCalledWith(TEMPLATE_ID);
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'КП шаблон',
          organizationId: new Types.ObjectId(ORG_A),
          sourceTemplateId: template._id,
          pageSize: 'A4',
          orientation: 'portrait',
          backgroundImage: ['/uploads/bg.png'],
          defaultBackgroundIndex: 0,
          backgroundOpacity: 0.5,
          pageNumbering: true,
          status: 'draft',
          revision: 1,
        }),
      );
      expect(blockService.cloneBlocksFromTemplate).toHaveBeenCalledWith(
        TEMPLATE_ID,
        String(created._id),
        TEMPLATE_ID,
      );
      expect(result).toBe(created);
    });

    it('uses custom name when provided', async () => {
      const { service, model, templateService } = createService();
      templateService.findById.mockResolvedValue({
        _id: new Types.ObjectId(TEMPLATE_ID),
        name: 'Template',
        organizationId: new Types.ObjectId(ORG_A),
        pageSize: 'A4',
        orientation: 'portrait',
      });
      model.create.mockResolvedValue(studioDoc({ name: 'Custom name' }));

      await service.createFromTemplate(TEMPLATE_ID, ORG_A, USER_ID, 'Custom name');

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Custom name' }),
      );
    });

    it('rejects foreign-org template with 403', async () => {
      const { service, templateService } = createService();
      templateService.findById.mockResolvedValue({
        _id: new Types.ObjectId(TEMPLATE_ID),
        name: 'Foreign',
        organizationId: new Types.ObjectId(ORG_B),
        pageSize: 'A4',
        orientation: 'portrait',
      });

      await expect(
        service.createFromTemplate(TEMPLATE_ID, ORG_A, USER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('duplicate (TZ-DOC-STUDIO-1301)', () => {
    it('creates draft copy and clones blocks', async () => {
      const { service, model, blockService } = createService();
      const sourceTemplateId = new Types.ObjectId();
      const src = studioDoc({
        name: 'Original',
        sourceTemplateId,
        dataSets: [{ key: 'items', rows: [] }],
        revision: 5,
        status: 'final',
      });
      const copy = studioDoc({
        _id: new Types.ObjectId(),
        name: 'Original (копия)',
        revision: 1,
        status: 'draft',
      });
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(src) });
      model.create.mockResolvedValue(copy);

      const result = await service.duplicate(DOC_ID, ORG_A, USER_ID);

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Original (копия)',
          status: 'draft',
          revision: 1,
          dataSets: src.dataSets,
        }),
      );
      expect(blockService.cloneBlocksFromStudioDocument).toHaveBeenCalledWith(
        DOC_ID,
        String(copy._id),
        String(sourceTemplateId),
      );
      expect(result).toBe(copy);
    });
  });

  describe('saveAsTemplate (TZ-DOC-STUDIO-1501)', () => {
    const TEMPLATE_ID = new Types.ObjectId().toString();

    it('creates template from studio doc and clones blocks', async () => {
      const { service, model, templateService, blockService } = createService();
      const docTypeId = new Types.ObjectId();
      const src = studioDoc({
        name: 'Working KP',
        docTypeId,
        pageSize: 'A4',
        orientation: 'landscape',
        backgroundImage: ['/uploads/bg.png'],
        defaultBackgroundIndex: 0,
        backgroundOpacity: 0.4,
        pageNumbering: true,
      });
      const createdTemplate = {
        _id: new Types.ObjectId(TEMPLATE_ID),
        name: 'KP шаблон',
        organizationId: new Types.ObjectId(ORG_A),
        docTypeId,
      };
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(src) });
      templateService.create.mockResolvedValue(createdTemplate);

      const result = await service.saveAsTemplate(
        DOC_ID,
        ORG_A,
        USER_ID,
        { name: 'KP шаблон', keepDataBindings: true },
      );

      expect(templateService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'KP шаблон',
          organizationId: ORG_A,
          docTypeId: String(docTypeId),
          pageSize: 'A4',
          orientation: 'landscape',
          backgroundImage: ['/uploads/bg.png'],
          defaultBackgroundIndex: 0,
          backgroundOpacity: 0.4,
          pageNumbering: true,
        }),
        USER_ID,
      );
      expect(blockService.cloneBlocksToTemplate).toHaveBeenCalledWith(
        DOC_ID,
        TEMPLATE_ID,
        true,
      );
      expect(result).toBe(createdTemplate);
    });

    it('defaults keepDataBindings to false', async () => {
      const { service, model, templateService, blockService } = createService();
      const docTypeId = new Types.ObjectId();
      model.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(studioDoc({ docTypeId })),
      });
      templateService.create.mockResolvedValue({
        _id: new Types.ObjectId(TEMPLATE_ID),
        name: 'T',
      });

      await service.saveAsTemplate(DOC_ID, ORG_A, USER_ID, { name: 'T' });

      expect(blockService.cloneBlocksToTemplate).toHaveBeenCalledWith(
        DOC_ID,
        TEMPLATE_ID,
        false,
      );
    });

    it('rejects empty template name', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(studioDoc({ docTypeId: new Types.ObjectId() })),
      });

      await expect(
        service.saveAsTemplate(DOC_ID, ORG_A, USER_ID, { name: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when docTypeId is missing', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(studioDoc({ docTypeId: undefined })),
      });

      await expect(
        service.saveAsTemplate(DOC_ID, ORG_A, USER_ID, { name: 'T' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects foreign-org document with 403', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(
          studioDoc({
            organizationId: new Types.ObjectId(ORG_B),
            docTypeId: new Types.ObjectId(),
          }),
        ),
      });

      await expect(
        service.saveAsTemplate(DOC_ID, ORG_A, USER_ID, { name: 'T' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('block mutations with revision gate (TZ-DOC-STUDIO-2002)', () => {
    const blockPayload = { type: 'text' as const, order: 0 };

    it('addBlock increments revision on expectedRevision match', async () => {
      const { service, model, blockService } = createService();
      const doc = studioDoc({ revision: 3 });
      const created = { _id: new Types.ObjectId(), ...blockPayload };
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });
      blockService.createForStudioDocument.mockResolvedValue(created);

      const result = await service.addBlock(DOC_ID, 3, blockPayload, ORG_A, USER_ID);

      expect(blockService.createForStudioDocument).toHaveBeenCalledWith(
        DOC_ID,
        blockPayload,
        undefined,
      );
      expect(doc.revision).toBe(4);
      expect(doc.save).toHaveBeenCalled();
      expect(result).toBe(created);
    });

    it('addBlock returns 409 on stale expectedRevision', async () => {
      const { service, model, blockService } = createService();
      const doc = studioDoc({ revision: 5 });
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      await expect(
        service.addBlock(DOC_ID, 2, blockPayload, ORG_A),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: STUDIO_DOCUMENT_REVISION_CONFLICT,
          revision: 5,
        }),
      });
      expect(blockService.createForStudioDocument).not.toHaveBeenCalled();
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('updateBlockLayouts increments revision and rejects stale client', async () => {
      const { service, model, blockService } = createService();
      const doc = studioDoc({ revision: 2 });
      const layoutsDto = {
        updates: [{ blockId: new Types.ObjectId().toString(), layout: { x: 1 } }],
      };
      const updatedBlocks = [{ _id: new Types.ObjectId() }];
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });
      blockService.updateLayoutsForStudioDocument.mockResolvedValue(updatedBlocks);

      const ok = await service.updateBlockLayouts(DOC_ID, 2, layoutsDto, ORG_A);
      expect(ok).toBe(updatedBlocks);
      expect(doc.revision).toBe(3);
      expect(doc.save).toHaveBeenCalled();

      await expect(
        service.updateBlockLayouts(DOC_ID, 2, layoutsDto, ORG_A),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reorderBlocks increments revision on match', async () => {
      const { service, model, blockService } = createService();
      const doc = studioDoc({ revision: 1 });
      const blockIds = [new Types.ObjectId().toString()];
      const reordered = [{ _id: new Types.ObjectId() }];
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });
      blockService.reorderForStudioDocument.mockResolvedValue(reordered);

      const result = await service.reorderBlocks(DOC_ID, 1, blockIds, ORG_A);

      expect(blockService.reorderForStudioDocument).toHaveBeenCalledWith(DOC_ID, blockIds);
      expect(doc.revision).toBe(2);
      expect(result).toBe(reordered);
    });
  });
});

describe('StudioDocumentService revision conflict payload', () => {
  it('ConflictException carries structured code for FE routing', async () => {
    const { service, model } = createService();
    const doc = studioDoc({ revision: 7 });
    model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

    try {
      await service.update(DOC_ID, { expectedRevision: 1 }, ORG_A);
      fail('expected ConflictException');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      const response = (err as ConflictException).getResponse() as Record<string, unknown>;
      expect(response.code).toBe(STUDIO_DOCUMENT_REVISION_CONFLICT);
      expect(response.revision).toBe(7);
      expect(response.updatedAt).toEqual(doc.updatedAt);
    }
  });
});
