import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { DocumentTemplateCategoryService } from './document-template-category.service';

const ORG_A = new Types.ObjectId().toString();
const ORG_B = new Types.ObjectId().toString();

/** Minimal mock Mongoose document (toObject-free). */
function catDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    name: 'Коммерческие предложения',
    slug: 'commercial-proposals',
    isActive: true,
    isSystem: false,
    isDefault: false,
    sortOrder: 0,
    save: jest.fn().mockImplementation(function (this: unknown) {
      return Promise.resolve(this);
    }),
    ...overrides,
  };
}

/** Minimal mock Mongoose query wrapper (matching project convention). */
function mockQuery<T>(value: T) {
  return { sort: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}

function createService(overrides: Record<string, unknown> = {}) {
  const model = {
    findOne: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    deleteOne: jest.fn(),
    countDocuments: jest.fn(),
  };
  const templateModel = {
    countDocuments: jest.fn(),
  };
  const dependencies = { model, templateModel, ...overrides };
  return {
    service: new DocumentTemplateCategoryService(
      dependencies.model as never,
      dependencies.templateModel as never,
    ),
    model: dependencies.model as {
      findOne: jest.Mock;
      find: jest.Mock;
      findById: jest.Mock;
      create: jest.Mock;
      deleteOne: jest.Mock;
      countDocuments: jest.Mock;
    },
    templateModel: dependencies.templateModel as { countDocuments: jest.Mock },
  };
}

describe('DocumentTemplateCategoryService (TZ-DOC-307)', () => {
  describe('create', () => {
    it('creates an org-scoped category with a stable slug', async () => {
      const { service, model } = createService();
      model.findOne.mockReturnValue(mockQuery(null));
      const doc = catDoc({ _id: new Types.ObjectId(), organizationId: new Types.ObjectId(ORG_A) });
      model.create.mockResolvedValue(doc);

      const result = await service.create(
        { name: 'Коммерческие предложения', slug: 'commercial-proposals' },
        ORG_A,
      );
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: 'commercial-proposals',
          organizationId: new Types.ObjectId(ORG_A),
          isSystem: false,
          isActive: true,
        }),
      );
      expect(result).toBe(doc);
    });

    it('GENERATES a server-side slug from a Cyrillic name when slug omitted', async () => {
      const { service, model } = createService();
      model.findOne.mockReturnValue(mockQuery(null));
      model.create.mockResolvedValue(catDoc({}));

      await service.create({ name: 'Коммерческие предложения' }, ORG_A);
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'kommercheskie-predlozheniya' }),
      );
    });

    it('rejects a duplicate slug in the SAME org scope with 409', async () => {
      const { service, model } = createService();
      model.findOne.mockReturnValue(mockQuery(catDoc({ organizationId: new Types.ObjectId(ORG_A) })));

      await expect(
        service.create({ name: 'Дубликат', slug: 'commercial-proposals' }, ORG_A),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('allows the same slug in a DIFFERENT org (ownership-scoped uniqueness)', async () => {
      const { service, model } = createService();
      model.findOne.mockReturnValue(mockQuery(null));
      model.create.mockResolvedValue(catDoc({ organizationId: new Types.ObjectId(ORG_A) }));

      const result = await service.create(
        { name: 'Коммерческие предложения', slug: 'commercial-proposals' },
        ORG_B,
      );
      expect(model.findOne).toHaveBeenCalledWith({
        organizationId: new Types.ObjectId(ORG_B),
        slug: 'commercial-proposals',
      });
      expect(result).toBeDefined();
    });
  });

  describe('findAll', () => {
    it('filters to org scope + system categories when organizationId provided', async () => {
      const { service, model } = createService();
      model.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) });

      await service.findAll({ organizationId: ORG_A });
      expect(model.find).toHaveBeenCalledWith({
        $or: [
          { organizationId: new Types.ObjectId(ORG_A) },
          { organizationId: { $exists: false } },
        ],
      });
    });

    it('returns only active categories when activeOnly=true', async () => {
      const { service, model } = createService();
      model.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) });

      await service.findAll({ activeOnly: true });
      expect(model.find).toHaveBeenCalledWith({ isActive: true });
    });

    it('COMBINES search and org scope via $and (search is never dropped)', async () => {
      const { service, model } = createService();
      model.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) });

      await service.findAll({ organizationId: ORG_A, search: 'Комм' });
      expect(model.find).toHaveBeenCalledWith({
        $and: [
          { name: new RegExp('Комм', 'i') },
          {
            $or: [
              { organizationId: new Types.ObjectId(ORG_A) },
              { organizationId: { $exists: false } },
            ],
          },
        ],
      });
    });

    it('ESCAPES regex metacharacters in the search term (no SyntaxError/ReDoS)', async () => {
      const { service, model } = createService();
      model.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) });

      // `(` and `[a-` would throw inside new RegExp if not escaped.
      await expect(
        service.findAll({ organizationId: ORG_A, search: '(комм [a-' }),
      ).resolves.toEqual([]);
      expect(model.find).toHaveBeenCalledWith({
        $and: [
          { name: new RegExp('\\(комм \\[a-', 'i') },
          {
            $or: [
              { organizationId: new Types.ObjectId(ORG_A) },
              { organizationId: { $exists: false } },
            ],
          },
        ],
      });
    });
  });

  describe('update / rename', () => {
    it('renames WITHOUT changing the id (template references stay stable)', async () => {
      const { service, model } = createService();
      const doc = catDoc({ _id: new Types.ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa'), name: 'Старое' });
      model.findById.mockReturnValue(mockQuery(doc));

      const result = await service.update(doc._id.toString(), { name: 'Новое имя' }, ORG_A);
      expect(result._id.toString()).toBe('aaaaaaaaaaaaaaaaaaaaaaaa');
      expect(result.name).toBe('Новое имя');
      expect(result.save).toHaveBeenCalled();
    });

    it('rejects a slug rename that collides in the same scope with 409', async () => {
      const { service, model } = createService();
      const doc = catDoc({ _id: new Types.ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa'), slug: 'old' });
      model.findById.mockReturnValue(mockQuery(doc));
      model.findOne.mockReturnValue(mockQuery(catDoc({ _id: new Types.ObjectId('bbbbbbbbbbbbbbbbbbbbbbbb') })));

      await expect(
        service.update(doc._id.toString(), { slug: 'new-slug' }, ORG_A),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('REFUSES to update a FOREIGN-ORG category with 403 (IDOR guard)', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(
        mockQuery(catDoc({ organizationId: new Types.ObjectId(ORG_B) })),
      );

      await expect(
        service.update(new Types.ObjectId().toString(), { name: 'Взлом' }, ORG_A),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // no save attempted on a foreign-org category
    });

    it('REFUSES to modify a SYSTEM category with 409 (seed-managed)', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(
        mockQuery(catDoc({ isSystem: true, organizationId: undefined })),
      );

      await expect(
        service.update(new Types.ObjectId().toString(), { name: 'Переименовать' }, ORG_A),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('resolveDefault', () => {
    it('prefers an active org-scoped isDefault category', async () => {
      const { service, model } = createService();
      const orgDefault = catDoc({ _id: new Types.ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa') });
      model.findOne.mockReturnValueOnce(mockQuery(orgDefault));

      const result = await service.resolveDefault(ORG_A);
      expect(result).toBe(orgDefault);
      expect(model.findOne).toHaveBeenCalledWith({
        organizationId: new Types.ObjectId(ORG_A),
        isActive: true,
        isDefault: true,
      });
    });

    it('falls back to the active system «Общее» when no org default exists', async () => {
      const { service, model } = createService();
      const systemDefault = catDoc({ _id: new Types.ObjectId('bbbbbbbbbbbbbbbbbbbbbbbb') });
      model.findOne.mockReturnValueOnce(mockQuery(null)).mockReturnValueOnce(mockQuery(systemDefault));

      const result = await service.resolveDefault(ORG_A);
      expect(result).toBe(systemDefault);
      expect(model.findOne).toHaveBeenLastCalledWith({
        organizationId: { $exists: false },
        isActive: true,
        isDefault: true,
      });
    });

    it('returns null when no default exists (caller must fail with 4xx)', async () => {
      const { service, model } = createService();
      model.findOne.mockReturnValue(mockQuery(null));

      await expect(service.resolveDefault(ORG_A)).resolves.toBeNull();
    });
  });

  describe('assertAssignable', () => {
    it('accepts an active category in the same org', async () => {
      const { service, model } = createService();
      const doc = catDoc({ organizationId: new Types.ObjectId(ORG_A) });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(service.assertAssignable(doc._id.toString(), ORG_A)).resolves.toBe(doc);
    });

    it('accepts an active SYSTEM (global) category for any org', async () => {
      const { service, model } = createService();
      const doc = catDoc({ isSystem: true, organizationId: undefined });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(service.assertAssignable(doc._id.toString(), ORG_A)).resolves.toBe(doc);
    });

    it('rejects a NONEXISTENT category with 404', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(mockQuery(null));

      await expect(service.assertAssignable(new Types.ObjectId().toString(), ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects an INACTIVE category with 400', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(mockQuery(catDoc({ isActive: false, organizationId: undefined })));

      await expect(service.assertAssignable(new Types.ObjectId().toString(), ORG_A)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a FOREIGN-ORG category with 400 (ownership isolation)', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(mockQuery(catDoc({ organizationId: new Types.ObjectId(ORG_B) })));

      await expect(service.assertAssignable(new Types.ObjectId().toString(), ORG_A)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a malformed categoryId with 400 before any lookup', async () => {
      const { service, model } = createService();

      await expect(service.assertAssignable('not-an-object-id', ORG_A)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(model.findById).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('refuses to delete a system category with 409', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(mockQuery(catDoc({ isSystem: true })));

      await expect(service.remove(new Types.ObjectId().toString(), ORG_A)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('REFUSES to delete a FOREIGN-ORG category with 403 (IDOR guard)', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(
        mockQuery(catDoc({ organizationId: new Types.ObjectId(ORG_B) })),
      );

      await expect(
        service.remove(new Types.ObjectId().toString(), ORG_A),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(model.deleteOne).not.toHaveBeenCalled();
    });

    it('refuses to delete a category referenced by templates with 409', async () => {
      const { service, model, templateModel } = createService();
      model.findById.mockReturnValue(mockQuery(catDoc({ isSystem: false })));
      templateModel.countDocuments.mockReturnValue(mockQuery(2));

      await expect(service.remove(new Types.ObjectId().toString(), ORG_A)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(templateModel.countDocuments).toHaveBeenCalledWith({
        categoryId: expect.anything(),
      });
    });

    it('deletes an unused, non-system category', async () => {
      const { service, model, templateModel } = createService();
      model.findById.mockReturnValue(mockQuery(catDoc({ isSystem: false })));
      templateModel.countDocuments.mockReturnValue(mockQuery(0));
      model.deleteOne.mockReturnValue(mockQuery(undefined));

      await service.remove(new Types.ObjectId().toString(), ORG_A);
      expect(model.deleteOne).toHaveBeenCalled();
    });
  });
});

// ─── Controller RBAC metadata (unit-level RBAC proof) ───

import { DocumentTemplateCategoryController } from './document-template-category.controller';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Reflector } from '@nestjs/core';

describe('DocumentTemplateCategoryController RBAC (TZ-DOC-307)', () => {
  const reflector = new Reflector();

  it('read routes require admin|manager roles', () => {
    const listRoles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      DocumentTemplateCategoryController.prototype.list,
      DocumentTemplateCategoryController,
    ]);
    const findRoles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      DocumentTemplateCategoryController.prototype.findOne,
      DocumentTemplateCategoryController,
    ]);
    expect(listRoles).toEqual(expect.arrayContaining(['admin', 'manager']));
    expect(findRoles).toEqual(expect.arrayContaining(['admin', 'manager']));
  });

  it('mutating routes require admin only', () => {
    const createRoles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      DocumentTemplateCategoryController.prototype.create,
      DocumentTemplateCategoryController,
    ]);
    const updateRoles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      DocumentTemplateCategoryController.prototype.update,
      DocumentTemplateCategoryController,
    ]);
    const removeRoles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      DocumentTemplateCategoryController.prototype.remove,
      DocumentTemplateCategoryController,
    ]);
    expect(createRoles).toEqual(['admin']);
    expect(updateRoles).toEqual(['admin']);
    expect(removeRoles).toEqual(['admin']);
  });
});
