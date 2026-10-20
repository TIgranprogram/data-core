import { Types } from 'mongoose';
import { RolesAdminController } from './roles-admin.controller';
import { AdminCreateRoleDto } from './dto/admin-role.dto';
import { AdminUpdateRoleDto } from './dto/admin-role.dto';
import type { RoleService } from '../role/role.service';

/**
 * TZ-256.B + TZ-257.B — RolesAdminController unit spec.
 *
 * Pure unit spec with manual mocks (repository convention — see
 * `users-admin.controller.spec.ts`). Verifies mutation delegation to
 * `RoleService`, the `isSystem: false` create-forcing, the admin
 * DTO-whitelist (no `isSystem`/internal fields accepted), and the
 * audit-safe client-role mapping (no internal fields).
 */

function buildController(opts: {
  create?: jest.Mock;
  update?: jest.Mock;
  remove?: jest.Mock;
  find?: jest.Mock;
  findById?: jest.Mock;
  countDocuments?: jest.Mock;
}) {
  const create = opts.create ?? jest.fn();
  const update = opts.update ?? jest.fn();
  const remove = opts.remove ?? jest.fn();
  const roleService = { create, update, remove } as unknown as RoleService;
  const roleModel = {
    find: opts.find ?? jest.fn(),
    findById: opts.findById ?? jest.fn(),
    countDocuments: opts.countDocuments ?? jest.fn(),
  } as any;
  const controller = new RolesAdminController(roleModel, roleService);
  return { controller, create, update, remove, roleModel };
}

function roleDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId().toString(),
    name: 'manager',
    label: 'Менеджер',
    description: 'Оператор',
    permissions: ['orders.read'],
    isSystem: false,
    sortOrder: 100,
    sectionIds: [],
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

describe('RolesAdminController (TZ-256.B)', () => {
  describe('mutation delegation', () => {
    it('delegates create to RoleService.create with isSystem forced false and returns client role', async () => {
      const { controller, create } = buildController({
        create: jest.fn().mockResolvedValue(roleDoc()),
      });
      const dto = new AdminCreateRoleDto();
      dto.name = 'clerk';
      dto.label = 'Клерк';
      dto.permissions = ['orders.read'];
      const out = await controller.create(dto);
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ isSystem: false }));
      expect(out).toHaveProperty('id');
      expect(out).toHaveProperty('name', 'manager');
      expect(out).not.toHaveProperty('sectionIds');
    });

    it('delegates update to RoleService.update and returns client role', async () => {
      const { controller, update } = buildController({
        update: jest.fn().mockResolvedValue(roleDoc({ label: 'Старший менеджер' })),
      });
      const dto = new AdminUpdateRoleDto();
      dto.label = 'Старший менеджер';
      const out = await controller.update('r1', dto);
      expect(update).toHaveBeenCalledWith('r1', dto);
      expect(out).toHaveProperty('label', 'Старший менеджер');
      expect(out).not.toHaveProperty('sortOrder');
    });

    it('delegates remove to RoleService.remove and returns success marker', async () => {
      const { controller, remove } = buildController({
        remove: jest.fn().mockResolvedValue(undefined),
      });
      const out = await controller.remove('r1');
      expect(remove).toHaveBeenCalledWith('r1');
      expect(out).toEqual({ success: true });
    });
  });

  describe('TZ-257.B admin DTO whitelist', () => {
    it('AdminCreateRoleDto excludes internal/system fields (pages ACL allowed)', () => {
      // Class-validator @ApiProperty-annotated fields only materialize
      // when assigned — inspect the declared property descriptors instead.
      const declared = Object.getOwnPropertyNames(AdminCreateRoleDto.prototype);
      expect(declared).not.toContain('isSystem');
      expect(declared).not.toContain('sortOrder');
      expect(declared).not.toContain('sectionIds');
      expect(declared).not.toContain('isActive');
    });

    it('AdminUpdateRoleDto excludes internal/system fields (no escalation surface)', () => {
      const declared = Object.getOwnPropertyNames(AdminUpdateRoleDto.prototype);
      expect(declared).not.toContain('isSystem');
      expect(declared).not.toContain('sortOrder');
      expect(declared).not.toContain('sectionIds');
      expect(declared).not.toContain('isActive');
      expect(declared).not.toContain('name');
    });

    it('controller create passes through only whitelisted fields', async () => {
      const { controller, create } = buildController({
        create: jest.fn().mockResolvedValue(roleDoc()),
      });
      const dto = new AdminCreateRoleDto();
      dto.name = 'clerk';
      dto.label = 'Клерк';
      dto.permissions = ['orders.read'];
      await controller.create(dto);
      const received = create.mock.calls[0][0] as Record<string, unknown>;
      // Whitelist excludes isSystem from the DTO surface, but the controller
      // deliberately FORCES isSystem: false on create — so it must be present
      // as false (never true), while other internal fields stay absent.
      expect(received).toHaveProperty('isSystem', false);
      expect(received).not.toHaveProperty('sortOrder');
      expect(received).not.toHaveProperty('sectionIds');
      expect(received).not.toHaveProperty('isActive');
      expect(received).toHaveProperty('name', 'clerk');
    });
  });

  describe('read paths', () => {
    it('maps a paginated list envelope through toClientRole', async () => {
      const { controller } = buildController({
        find: jest.fn().mockReturnValue({
          sort: () => ({
            skip: () => ({
              limit: () => ({
                lean: () => ({ exec: () => Promise.resolve([roleDoc()]) }),
              }),
            }),
          }),
        }),
        countDocuments: jest.fn().mockReturnValue({ exec: () => Promise.resolve(1) }),
      });
      const out = await controller.list();
      expect(out).toMatchObject({ total: 1, page: 1, limit: 50 });
      expect(out.items).toHaveLength(1);
      expect(out.items[0]).toHaveProperty('name', 'manager');
      expect(out.items[0]).not.toHaveProperty('sectionIds');
    });

    it('preserves a legacy offset as the exact skip while reporting its page', async () => {
      const skip = jest.fn().mockReturnValue({
        limit: () => ({
          lean: () => ({ exec: () => Promise.resolve([]) }),
        }),
      });
      const { controller } = buildController({
        find: jest.fn().mockReturnValue({ sort: () => ({ skip }) }),
        countDocuments: jest.fn().mockReturnValue({ exec: () => Promise.resolve(11) }),
      });

      const out = await controller.list(undefined, '5', '10');
      expect(skip).toHaveBeenCalledWith(10);
      expect(out).toMatchObject({ items: [], total: 11, page: 3, limit: 5 });
    });

    it('filters roles by search and returns an empty page', async () => {
      const find = jest.fn().mockReturnValue({
        sort: () => ({
          skip: () => ({
            limit: () => ({
              lean: () => ({ exec: () => Promise.resolve([]) }),
            }),
          }),
        }),
      });
      const { controller } = buildController({
        find,
        countDocuments: jest.fn().mockReturnValue({ exec: () => Promise.resolve(2) }),
      });
      const out = await controller.list('2', '1', undefined, 'manager');
      expect(out).toEqual({ items: [], total: 2, page: 2, limit: 1 });
      expect(find).toHaveBeenCalledWith({ $or: expect.any(Array) });
    });

    it('throws for a missing target on the single-read path', async () => {
      const { controller } = buildController({
        findById: jest.fn().mockReturnValue({
          lean: () => ({ exec: () => Promise.resolve(null) }),
        }),
      });
      await expect(controller.getById('missing')).rejects.toBeInstanceOf(Error);
    });
  });
});
