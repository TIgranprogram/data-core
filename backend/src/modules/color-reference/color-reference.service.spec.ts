import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ColorReferenceService } from './color-reference.service';

const ORG_A = new Types.ObjectId().toString();
const ORG_B = new Types.ObjectId().toString();

/** Minimal mock Mongoose document (toObject-free). */
function colorDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    name: 'RAL 9003 — Сигнальный белый',
    slug: 'ral-9003-signalny-belyy',
    hex: '#F4F4F4',
    description: undefined,
    isActive: true,
    isSystem: false,
    isDefault: false,
    deletedAt: undefined,
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
  };
  const dependencies = { model, ...overrides };
  return {
    service: new ColorReferenceService(dependencies.model as never),
    model: dependencies.model as {
      findOne: jest.Mock;
      find: jest.Mock;
      findById: jest.Mock;
      create: jest.Mock;
      deleteOne: jest.Mock;
    },
  };
}

describe('ColorReferenceService (TZ-PRODUCTS-301)', () => {
  describe('create', () => {
    it('creates an org-scoped color with a stable slug', async () => {
      const { service, model } = createService();
      model.findOne.mockReturnValue(mockQuery(null));
      const doc = colorDoc({ _id: new Types.ObjectId(), organizationId: new Types.ObjectId(ORG_A) });
      model.create.mockResolvedValue(doc);

      const result = await service.create(
        { name: 'RAL 9003 — Сигнальный белый', slug: 'ral-9003-signalny-belyy', hex: '#F4F4F4' },
        ORG_A,
      );
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: 'ral-9003-signalny-belyy',
          hex: '#F4F4F4',
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
      model.create.mockResolvedValue(colorDoc({}));

      await service.create({ name: 'Не выбран' }, ORG_A);
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'ne-vybran' }),
      );
    });

    it('rejects an INVALID hex with 400 (service-level backstop)', async () => {
      const { service, model } = createService();

      await expect(
        service.create({ name: 'Плохой цвет', hex: 'F4F4F4' }, ORG_A),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate slug in the SAME org scope with 409', async () => {
      const { service, model } = createService();
      model.findOne.mockReturnValue(mockQuery(colorDoc({ organizationId: new Types.ObjectId(ORG_A) })));

      await expect(
        service.create({ name: 'Дубликат', slug: 'ral-9003-signalny-belyy' }, ORG_A),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('allows the same slug in a DIFFERENT org (ownership-scoped uniqueness)', async () => {
      const { service, model } = createService();
      model.findOne.mockReturnValue(mockQuery(null));
      model.create.mockResolvedValue(colorDoc({ organizationId: new Types.ObjectId(ORG_A) }));

      const result = await service.create(
        { name: 'RAL 9003 — Сигнальный белый', slug: 'ral-9003-signalny-belyy' },
        ORG_B,
      );
      expect(model.findOne).toHaveBeenCalledWith({
        organizationId: new Types.ObjectId(ORG_B),
        slug: 'ral-9003-signalny-belyy',
      });
      expect(result).toBeDefined();
    });
  });

  describe('findAll', () => {
    it('filters to org scope + system colors when organizationId provided', async () => {
      const { service, model } = createService();
      model.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) });

      await service.findAll({ organizationId: ORG_A });
      expect(model.find).toHaveBeenCalledWith({
        deletedAt: { $exists: false },
        $or: [
          { organizationId: new Types.ObjectId(ORG_A) },
          { organizationId: { $exists: false } },
        ],
      });
    });

    it('returns only active colors when activeOnly=true', async () => {
      const { service, model } = createService();
      model.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) });

      await service.findAll({ activeOnly: true });
      expect(model.find).toHaveBeenCalledWith({
        deletedAt: { $exists: false },
        isActive: true,
      });
    });

    it('COMBINES search (name OR slug) and org scope via $and (search is never dropped)', async () => {
      const { service, model } = createService();
      model.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) });

      await service.findAll({ organizationId: ORG_A, search: 'RAL 9003' });
      expect(model.find).toHaveBeenCalledWith({
        deletedAt: { $exists: false },
        $and: [
          {
            $or: [
              { name: new RegExp('RAL 9003', 'i') },
              { slug: new RegExp('RAL 9003', 'i') },
            ],
          },
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

      await expect(
        service.findAll({ organizationId: ORG_A, search: '(белый [a-' }),
      ).resolves.toEqual([]);
      expect(model.find).toHaveBeenCalledWith({
        deletedAt: { $exists: false },
        $and: [
          {
            $or: [
              { name: new RegExp('\\(белый \\[a-', 'i') },
              { slug: new RegExp('\\(белый \\[a-', 'i') },
            ],
          },
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
    it('renames WITHOUT changing the id (product ralCode references stay stable)', async () => {
      const { service, model } = createService();
      const doc = colorDoc({ _id: new Types.ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa'), name: 'Старое' });
      model.findById.mockReturnValue(mockQuery(doc));

      const result = await service.update(doc._id.toString(), { name: 'Новое имя' }, ORG_A);
      expect(result._id.toString()).toBe('aaaaaaaaaaaaaaaaaaaaaaaa');
      expect(result.name).toBe('Новое имя');
      expect(result.save).toHaveBeenCalled();
    });

    it('rejects a slug rename that collides in the same scope with 409', async () => {
      const { service, model } = createService();
      const doc = colorDoc({ _id: new Types.ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa'), slug: 'old' });
      model.findById.mockReturnValue(mockQuery(doc));
      model.findOne.mockReturnValue(mockQuery(colorDoc({ _id: new Types.ObjectId('bbbbbbbbbbbbbbbbbbbbbbbb') })));

      await expect(
        service.update(doc._id.toString(), { slug: 'new-slug' }, ORG_A),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('REFUSES to update a FOREIGN-ORG color with 403 (IDOR guard)', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(
        mockQuery(colorDoc({ organizationId: new Types.ObjectId(ORG_B) })),
      );

      await expect(
        service.update(new Types.ObjectId().toString(), { name: 'Взлом' }, ORG_A),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('REFUSES to modify a SYSTEM color with 409 (seed-managed)', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(
        mockQuery(colorDoc({ isSystem: true, organizationId: undefined })),
      );

      await expect(
        service.update(new Types.ObjectId().toString(), { name: 'Переименовать' }, ORG_A),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects an INVALID hex on update with 400', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(mockQuery(colorDoc({ organizationId: undefined })));

      await expect(
        service.update(new Types.ObjectId().toString(), { hex: 'not-a-color' }, ORG_A),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('resolveDefault', () => {
    it('prefers an active org-scoped isDefault color', async () => {
      const { service, model } = createService();
      const orgDefault = colorDoc({ _id: new Types.ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa') });
      model.findOne.mockReturnValueOnce(mockQuery(orgDefault));

      const result = await service.resolveDefault(ORG_A);
      expect(result).toBe(orgDefault);
      expect(model.findOne).toHaveBeenCalledWith({
        organizationId: new Types.ObjectId(ORG_A),
        isActive: true,
        isDefault: true,
        deletedAt: { $exists: false },
      });
    });

    it('falls back to the active system «Не выбран» when no org default exists', async () => {
      const { service, model } = createService();
      const systemDefault = colorDoc({ _id: new Types.ObjectId('bbbbbbbbbbbbbbbbbbbbbbbb') });
      model.findOne.mockReturnValueOnce(mockQuery(null)).mockReturnValueOnce(mockQuery(systemDefault));

      const result = await service.resolveDefault(ORG_A);
      expect(result).toBe(systemDefault);
      expect(model.findOne).toHaveBeenLastCalledWith({
        organizationId: { $exists: false },
        isActive: true,
        isDefault: true,
        deletedAt: { $exists: false },
      });
    });

    it('returns null when no default exists (caller must fail with 4xx)', async () => {
      const { service, model } = createService();
      model.findOne.mockReturnValue(mockQuery(null));

      await expect(service.resolveDefault(ORG_A)).resolves.toBeNull();
    });
  });

  describe('assertDefaultId', () => {
    it('accepts an active isDefault color in the same org', async () => {
      const { service, model } = createService();
      const doc = colorDoc({ isDefault: true, organizationId: new Types.ObjectId(ORG_A) });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(service.assertDefaultId(doc._id.toString(), ORG_A)).resolves.toBe(doc);
    });

    it('accepts an active SYSTEM default for any org', async () => {
      const { service, model } = createService();
      const doc = colorDoc({ isDefault: true, isSystem: true, organizationId: undefined });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(service.assertDefaultId(doc._id.toString(), ORG_A)).resolves.toBe(doc);
    });

    it('rejects a color NOT marked isDefault with 400', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(mockQuery(colorDoc({ isDefault: false, organizationId: undefined })));

      await expect(
        service.assertDefaultId(new Types.ObjectId().toString(), ORG_A),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a malformed colorId with 400 before any lookup', async () => {
      const { service, model } = createService();

      await expect(service.assertDefaultId('not-an-object-id', ORG_A)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(model.findById).not.toHaveBeenCalled();
    });
  });

  describe('assertAssignable', () => {
    it('accepts an active color in the same org', async () => {
      const { service, model } = createService();
      const doc = colorDoc({ organizationId: new Types.ObjectId(ORG_A) });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(service.assertAssignable(doc._id.toString(), ORG_A)).resolves.toBe(doc);
    });

    it('accepts an active SYSTEM (global) color for any org', async () => {
      const { service, model } = createService();
      const doc = colorDoc({ isSystem: true, organizationId: undefined });
      model.findById.mockReturnValue(mockQuery(doc));

      await expect(service.assertAssignable(doc._id.toString(), ORG_A)).resolves.toBe(doc);
    });

    it('rejects a NONEXISTENT color with 404', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(mockQuery(null));

      await expect(service.assertAssignable(new Types.ObjectId().toString(), ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects an INACTIVE color with 400', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(mockQuery(colorDoc({ isActive: false, organizationId: undefined })));

      await expect(service.assertAssignable(new Types.ObjectId().toString(), ORG_A)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a FOREIGN-ORG color with 400 (ownership isolation)', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(mockQuery(colorDoc({ organizationId: new Types.ObjectId(ORG_B) })));

      await expect(service.assertAssignable(new Types.ObjectId().toString(), ORG_A)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a malformed colorId with 400 before any lookup', async () => {
      const { service, model } = createService();

      await expect(service.assertAssignable('not-an-object-id', ORG_A)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(model.findById).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('refuses to delete a system color with 409', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(mockQuery(colorDoc({ isSystem: true })));

      await expect(service.remove(new Types.ObjectId().toString(), ORG_A)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses to delete the isDefault color with 409 (used by the default contract)', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(mockQuery(colorDoc({ isSystem: false, isDefault: true })));

      await expect(service.remove(new Types.ObjectId().toString(), ORG_A)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('REFUSES to delete a FOREIGN-ORG color with 403 (IDOR guard)', async () => {
      const { service, model } = createService();
      model.findById.mockReturnValue(
        mockQuery(colorDoc({ organizationId: new Types.ObjectId(ORG_B) })),
      );

      await expect(
        service.remove(new Types.ObjectId().toString(), ORG_A),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(model.deleteOne).not.toHaveBeenCalled();
    });

    it('SOFT-DELETES an unused, non-system, non-default color (sets deletedAt)', async () => {
      const { service, model } = createService();
      const doc = colorDoc({ isSystem: false, isDefault: false });
      model.findById.mockReturnValue(mockQuery(doc));

      await service.remove(new Types.ObjectId().toString(), ORG_A);
      expect(doc.deletedAt).toBeInstanceOf(Date);
      expect(doc.save).toHaveBeenCalled();
    });
  });
});

// ─── Controller RBAC + Audit metadata (unit-level proof) ───

import { ColorReferenceController } from './color-reference.controller';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AUDIT_ACTION_KEY } from '../../common/interceptors/audit.interceptor';
import { Reflector } from '@nestjs/core';

describe('ColorReferenceController RBAC (TZ-PRODUCTS-301)', () => {
  const reflector = new Reflector();

  it('read routes require user|admin|director|manager roles (TZ-OPS-314: director read-only)', () => {
    const listRoles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ColorReferenceController.prototype.list,
      ColorReferenceController,
    ]);
    const findRoles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ColorReferenceController.prototype.findOne,
      ColorReferenceController,
    ]);
    expect(listRoles).toEqual(['user', 'admin', 'director', 'manager']);
    expect(findRoles).toEqual(['user', 'admin', 'director', 'manager']);
  });

  it('mutating routes require admin|manager only', () => {
    const createRoles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ColorReferenceController.prototype.create,
      ColorReferenceController,
    ]);
    const updateRoles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ColorReferenceController.prototype.update,
      ColorReferenceController,
    ]);
    const removeRoles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ColorReferenceController.prototype.remove,
      ColorReferenceController,
    ]);
    expect(createRoles).toEqual(['admin', 'manager']);
    expect(updateRoles).toEqual(['admin', 'manager']);
    expect(removeRoles).toEqual(['admin', 'manager']);
  });

  it('every mutating route carries AuditAction metadata', () => {
    const createMeta = reflector.getAllAndOverride<{ action: string; entityType: string }>(
      AUDIT_ACTION_KEY,
      [ColorReferenceController.prototype.create, ColorReferenceController],
    );
    const updateMeta = reflector.getAllAndOverride<{ action: string }>(AUDIT_ACTION_KEY, [
      ColorReferenceController.prototype.update,
      ColorReferenceController,
    ]);
    const removeMeta = reflector.getAllAndOverride<{ action: string }>(AUDIT_ACTION_KEY, [
      ColorReferenceController.prototype.remove,
      ColorReferenceController,
    ]);
    expect(createMeta).toMatchObject({ action: 'create', entityType: 'ColorReference' });
    expect(updateMeta).toMatchObject({ action: 'update' });
    expect(removeMeta).toMatchObject({ action: 'delete' });
  });
});
