import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DocumentTemplateService } from './document-template.service';
import { DocumentRenderService } from '../document-render/document-render.service';
import { BLANK_A4_SENTINEL_TAG } from './blank-a4-template.constants';

const ORG_A = new Types.ObjectId().toString();
const CAT_ID = new Types.ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa');
const FALLBACK_ID = new Types.ObjectId('bbbbbbbbbbbbbbbbbbbbbbbb');

function lookup<T>(value: T) {
  return {
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

/** Chainable mock matching the service's `findById` usage: .findById(id).populate().populate().populate().exec() */
function findByIdChain(value: unknown) {
  return {
    populate: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

/** Build the service with mock models; only category-related methods are exercised. */
function createService(overrides: Record<string, unknown> = {}) {
  const model = {
    create: jest.fn().mockImplementation((doc) => Promise.resolve({ _id: new Types.ObjectId(), ...doc })),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    find: jest.fn(),
    findById: jest.fn(),
    deleteOne: jest.fn().mockResolvedValue({}),
  };
  const blockModel = { find: jest.fn().mockReturnValue(lookup([])) };
  const quotationModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const contractModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const orderModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const orgModel = {};
  const counterpartyModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const productModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const materialModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const workTypeModel = { findById: jest.fn().mockReturnValue(lookup(null)) };
  const textBlockModel = {};
  const counter = {};
  const tableTemplateService = {};
  const categoryService = {
    assertAssignable: jest.fn(),
    resolveDefault: jest.fn(),
  };

  const dependencies = {
    model,
    blockModel,
    quotationModel,
    contractModel,
    orderModel,
    orgModel,
    counterpartyModel,
    productModel,
    materialModel,
    workTypeModel,
    textBlockModel,
    counter,
    tableTemplateService,
    categoryService,
    ...overrides,
  };

  const service = new DocumentTemplateService(
    dependencies.model as never,
    dependencies.blockModel as never,
    dependencies.quotationModel as never,
    dependencies.contractModel as never,
    dependencies.orderModel as never,
    dependencies.orgModel as never,
    dependencies.counterpartyModel as never,
    dependencies.productModel as never,
    dependencies.materialModel as never,
    dependencies.workTypeModel as never,
    dependencies.textBlockModel as never,
    dependencies.counter as never,
    dependencies.tableTemplateService as never,
    dependencies.categoryService as never,
    {} as never,
    new DocumentRenderService(),
  );
  return { service, model: dependencies.model as { create: jest.Mock; find: jest.Mock; findById: jest.Mock }, categoryService };
}

describe('DocumentTemplateService category contract (TZ-DOC-307)', () => {
  const baseDto = {
    name: 'КП по умолчанию',
    organizationId: ORG_A,
    docTypeId: new Types.ObjectId().toString(),
  };

  describe('create with explicit categoryId', () => {
    it('stores the provided categoryId after assignability validation', async () => {
      const { service, model, categoryService } = createService();
      categoryService.assertAssignable.mockResolvedValue({ _id: new Types.ObjectId(CAT_ID) });

      const result = await service.create({ ...baseDto, categoryId: CAT_ID.toString() });
      expect(categoryService.assertAssignable).toHaveBeenCalledWith(CAT_ID.toString(), ORG_A);
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: new Types.ObjectId(CAT_ID) }),
      );
      expect(result.categoryId).toEqual(new Types.ObjectId(CAT_ID));
    });

    it('rejects a NONEXISTENT category (404 propagates) and does NOT create', async () => {
      const { service, model, categoryService } = createService();
      categoryService.assertAssignable.mockRejectedValue(new NotFoundException('not found'));

      await expect(service.create({ ...baseDto, categoryId: CAT_ID.toString() })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(model.create).not.toHaveBeenCalled();
    });

    it('rejects an INACTIVE category (400 propagates) and does NOT create', async () => {
      const { service, model, categoryService } = createService();
      categoryService.assertAssignable.mockRejectedValue(new BadRequestException('inactive'));

      await expect(service.create({ ...baseDto, categoryId: CAT_ID.toString() })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(model.create).not.toHaveBeenCalled();
    });

    it('rejects a FOREIGN-ORG category (ownership isolation, 400)', async () => {
      const { service, model, categoryService } = createService();
      categoryService.assertAssignable.mockRejectedValue(new BadRequestException('foreign org'));

      await expect(service.create({ ...baseDto, categoryId: CAT_ID.toString() })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(model.create).not.toHaveBeenCalled();
    });
  });

  describe('server-side default (no categoryId)', () => {
    it('assigns the active default category when categoryId is omitted', async () => {
      const { service, model, categoryService } = createService();
      categoryService.resolveDefault.mockResolvedValue({ _id: new Types.ObjectId(CAT_ID) });

      const result = await service.create(baseDto);
      expect(categoryService.resolveDefault).toHaveBeenCalledWith(ORG_A);
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: new Types.ObjectId(CAT_ID) }),
      );
      expect(result.categoryId).toEqual(new Types.ObjectId(CAT_ID));
    });

    it('FAILS with a testable 400 and does NOT create when the default is unresolvable', async () => {
      const { service, model, categoryService } = createService();
      categoryService.resolveDefault.mockResolvedValue(null);

      await expect(service.create(baseDto)).rejects.toBeInstanceOf(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('validates a new categoryId on update', async () => {
      const { service, model, categoryService } = createService();
      const doc = {
        _id: new Types.ObjectId(),
        organizationId: new Types.ObjectId(ORG_A),
        categoryId: undefined,
        name: 'Старое',
        save: jest.fn().mockImplementation(function (this: unknown) { return Promise.resolve(this); }),
      };
      model.findById.mockReturnValue(findByIdChain(doc));
      categoryService.assertAssignable.mockResolvedValue({ _id: new Types.ObjectId(CAT_ID) });

      await service.update(doc._id.toString(), { categoryId: CAT_ID.toString() });
      expect(categoryService.assertAssignable).toHaveBeenCalledWith(CAT_ID.toString(), ORG_A);
      expect(doc.categoryId).toEqual(new Types.ObjectId(CAT_ID));
      expect(doc.save).toHaveBeenCalled();
    });

    it('rejects updating to a foreign/inactive category (400 propagates)', async () => {
      const { service, model, categoryService } = createService();
      const doc = {
        _id: new Types.ObjectId(),
        organizationId: new Types.ObjectId(ORG_A),
        name: 'Старое',
        save: jest.fn(),
      };
      model.findById.mockReturnValue(findByIdChain(doc));
      categoryService.assertAssignable.mockRejectedValue(new BadRequestException('foreign org'));

      await expect(service.update(doc._id.toString(), { categoryId: CAT_ID.toString() })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('duplicate', () => {
    it('preserves the source template categoryId after assignability validation', async () => {
      const { service, model, categoryService } = createService();
      const src = {
        _id: new Types.ObjectId(),
        name: 'Исходный',
        description: undefined,
        tags: [],
        organizationId: new Types.ObjectId(ORG_A),
        docTypeId: new Types.ObjectId(),
        categoryId: new Types.ObjectId(CAT_ID),
        isDefault: false,
        isActive: true,
        pageSize: 'A4',
        orientation: 'portrait',
        backgroundImage: [],
        defaultBackgroundIndex: -1,
        backgroundOpacity: 0.3,
        headerText: undefined,
        footerText: undefined,
        pageNumbering: undefined,
        tableOfContents: undefined,
        version: 1,
        notes: undefined,
      };
      model.findById.mockReturnValue(findByIdChain(src));
      categoryService.assertAssignable.mockResolvedValue({ _id: new Types.ObjectId(CAT_ID) });

      await service.duplicate(src._id.toString());
      expect(categoryService.assertAssignable).toHaveBeenCalledWith(CAT_ID.toString(), ORG_A);
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: new Types.ObjectId(CAT_ID) }),
      );
      expect(categoryService.resolveDefault).not.toHaveBeenCalled();
    });

    it('FALLS BACK to the server default when the source category is no longer assignable', async () => {
      const { service, model, categoryService } = createService();
      const src = {
        _id: new Types.ObjectId(),
        name: 'Исходный',
        description: undefined,
        tags: [],
        organizationId: new Types.ObjectId(ORG_A),
        docTypeId: new Types.ObjectId(),
        categoryId: new Types.ObjectId(CAT_ID),
        isDefault: false,
        isActive: true,
        pageSize: 'A4',
        orientation: 'portrait',
        backgroundImage: [],
        defaultBackgroundIndex: -1,
        backgroundOpacity: 0.3,
        version: 1,
      };
      model.findById.mockReturnValue(findByIdChain(src));
      categoryService.assertAssignable.mockRejectedValue(new BadRequestException('inactive'));
      categoryService.resolveDefault.mockResolvedValue({ _id: new Types.ObjectId(FALLBACK_ID) });

      await service.duplicate(src._id.toString());
      expect(categoryService.assertAssignable).toHaveBeenCalledWith(CAT_ID.toString(), ORG_A);
      expect(categoryService.resolveDefault).toHaveBeenCalledWith(ORG_A);
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: new Types.ObjectId(FALLBACK_ID) }),
      );
    });

    it('FAILS with a testable 400 when the source category is gone and no default exists', async () => {
      const { service, model, categoryService } = createService();
      const src = {
        _id: new Types.ObjectId(),
        name: 'Исходный',
        description: undefined,
        tags: [],
        organizationId: new Types.ObjectId(ORG_A),
        docTypeId: new Types.ObjectId(),
        categoryId: new Types.ObjectId(CAT_ID),
        isDefault: false,
        isActive: true,
        pageSize: 'A4',
        orientation: 'portrait',
        backgroundImage: [],
        defaultBackgroundIndex: -1,
        backgroundOpacity: 0.3,
        version: 1,
      };
      model.findById.mockReturnValue(findByIdChain(src));
      categoryService.assertAssignable.mockRejectedValue(new BadRequestException('inactive'));
      categoryService.resolveDefault.mockResolvedValue(null);

      await expect(service.duplicate(src._id.toString())).rejects.toBeInstanceOf(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll categoryId filter', () => {
    it('filters templates by categoryId', async () => {
      const { service, model } = createService();
      model.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      });

      await service.findAll(ORG_A, undefined, undefined, CAT_ID.toString());
      // TZ-NX-DOCSTUDIO-TEMPLATES-NO-SENTINEL-SPAM: findAll always excludes
      // soft-deleted rows and the internal blank-A4 sentinel, alongside org/category scope.
      expect(model.find).toHaveBeenCalledWith({
        deletedAt: null,
        tags: { $ne: BLANK_A4_SENTINEL_TAG },
        organizationId: new Types.ObjectId(ORG_A),
        categoryId: new Types.ObjectId(CAT_ID),
      });
    });

    it('returns [] for a malformed categoryId instead of crashing', async () => {
      const { service, model } = createService();

      const result = await service.findAll(ORG_A, undefined, undefined, 'bad-id');
      expect(result).toEqual([]);
      expect(model.find).not.toHaveBeenCalled();
    });
  });

  describe('legacy templates (no categoryId)', () => {
    it('findAll tolerates templates without categoryId (no crash, no join)', async () => {
      const { service, model } = createService();
      const legacy = { _id: new Types.ObjectId(), name: 'Старый шаблон' };
      const populated = { ...legacy, categoryId: undefined };
      model.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([populated]),
      });

      const result = await service.findAll(ORG_A);
      expect(result).toHaveLength(1);
      expect(result[0].categoryId).toBeUndefined();
    });

    it('duplicate of a legacy template (no categoryId) keeps categoryId absent and never validates', async () => {
      const { service, model, categoryService } = createService();
      const src = {
        _id: new Types.ObjectId(),
        name: 'Legacy',
        description: undefined,
        tags: [],
        organizationId: new Types.ObjectId(ORG_A),
        docTypeId: new Types.ObjectId(),
        categoryId: undefined,
        isDefault: false,
        isActive: true,
        pageSize: 'A4',
        orientation: 'portrait',
        backgroundImage: [],
        defaultBackgroundIndex: -1,
        backgroundOpacity: 0.3,
        version: 1,
      };
      model.findById.mockReturnValue(findByIdChain(src));

      await service.duplicate(src._id.toString());
      expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ categoryId: undefined }));
      expect(categoryService.assertAssignable).not.toHaveBeenCalled();
      expect(categoryService.resolveDefault).not.toHaveBeenCalled();
    });
  });

  describe('TZ-KP-WS-406 MCP/import bridge fields', () => {
    it('passes sourceFileRef + draftSource through to model.create', async () => {
      const { service, model, categoryService } = createService();
      categoryService.resolveDefault.mockResolvedValue({ _id: new Types.ObjectId(CAT_ID) });

      const result = await service.create({
        ...baseDto,
        sourceFileRef: 'C:\\imports\\kp\u043e\u0440\u043e\u0431\u043a\u0430.pdf',
        draftSource: 'mcp',
      });

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceFileRef: 'C:\\imports\\kp\u043e\u0440\u043e\u0431\u043a\u0430.pdf',
          draftSource: 'mcp',
        }),
      );
      expect(result.sourceFileRef).toBe('C:\\imports\\kp\u043e\u0440\u043e\u0431\u043a\u0430.pdf');
      expect(result.draftSource).toBe('mcp');
    });

    it('defaults draftSource to null when omitted (legacy compatibility)', async () => {
      const { service, model, categoryService } = createService();
      categoryService.resolveDefault.mockResolvedValue({ _id: new Types.ObjectId(CAT_ID) });

      await service.create(baseDto);
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ draftSource: null }),
      );
    });
  });
});
