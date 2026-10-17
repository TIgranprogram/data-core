import { Types } from 'mongoose';
import { WorkerController } from './worker.controller';
import type { WorkerService } from './worker.service';
import { FindWorkersDto } from './dto/find-workers.dto';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

/**
 * TZ-WORKERS-301 — WorkerController unit spec.
 *
 * Pure unit spec с manual mocks (репозиторная конвенция). Проверяет:
 *  - organizationId берётся из req.user, НЕ из DTO/тела (IDOR guard);
 *  - делегирование findAll/create/update/remove в WorkerService;
 *  - RBAC-метаданные на эндпоинтах (read: user+; mutations: manager+).
 */

function buildController(opts: {
  findAll?: jest.Mock;
  findById?: jest.Mock;
  create?: jest.Mock;
  update?: jest.Mock;
  remove?: jest.Mock;
} = {}) {
  const findAll = opts.findAll ?? jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
  const findById = opts.findById ?? jest.fn().mockResolvedValue({ _id: 'x' });
  const create = opts.create ?? jest.fn().mockResolvedValue({ _id: 'x' });
  const update = opts.update ?? jest.fn().mockResolvedValue({ _id: 'x' });
  const remove = opts.remove ?? jest.fn().mockResolvedValue(undefined);
  const service = { findAll, findById, create, update, remove } as unknown as WorkerService;
  const controller = new WorkerController(service);
  return { controller, findAll, findById, create, update, remove };
}

function reqWithOrg(organizationId?: string | null) {
  return {
    user: { organizationId, role: 'manager' },
  } as unknown as Parameters<WorkerController['findAll']>[1];
}

describe('WorkerController (TZ-WORKERS-301)', () => {
  it('delegates findAll and passes organizationId from req.user', async () => {
    const { controller, findAll } = buildController();
    const orgId = new Types.ObjectId().toString();
    const query: FindWorkersDto = { page: 2, limit: 10, search: 'иван', isActive: true };
    await controller.findAll(query, reqWithOrg(orgId));
    expect(findAll).toHaveBeenCalledWith(query, orgId);
  });

  it('passes null organizationId when user has no org', async () => {
    const { controller, findAll } = buildController();
    await controller.findAll({}, reqWithOrg(null));
    expect(findAll).toHaveBeenCalledWith({}, null);
  });

  it('delegates create with org scope from req.user', async () => {
    const { controller, create } = buildController();
    const orgId = new Types.ObjectId().toString();
    const dto = { lastName: 'Иванов', firstName: 'Иван', email: 'i@e.com' };
    await controller.create(dto, reqWithOrg(orgId));
    expect(create).toHaveBeenCalledWith(dto, orgId);
  });

  it('delegates update with id, dto and org scope', async () => {
    const { controller, update } = buildController();
    const id = new Types.ObjectId().toString();
    const orgId = new Types.ObjectId().toString();
    await controller.update(id, { position: 'Директор' }, reqWithOrg(orgId));
    expect(update).toHaveBeenCalledWith(id, { position: 'Директор' }, orgId);
  });

  it('delegates remove with id and org scope', async () => {
    const { controller, remove } = buildController();
    const id = new Types.ObjectId().toString();
    const orgId = new Types.ObjectId().toString();
    await controller.remove(id, reqWithOrg(orgId));
    expect(remove).toHaveBeenCalledWith(id, orgId);
  });

  it('delegates findById with org scope from req.user (single record read)', async () => {
    const { controller, findById } = buildController();
    const id = new Types.ObjectId().toString();
    const orgId = new Types.ObjectId().toString();
    await controller.findOne(id, reqWithOrg(orgId));
    expect(findById).toHaveBeenCalledWith(id, orgId);
  });

  describe('RBAC metadata', () => {
    it('read endpoints allow user role', () => {
      const { controller } = buildController();
      const roles = Reflect.getMetadata(ROLES_KEY, controller.findAll);
      expect(roles).toContain('user');
      const oneRoles = Reflect.getMetadata(ROLES_KEY, controller.findOne);
      expect(oneRoles).toContain('user');
    });

    it('mutations require manager or admin', () => {
      const { controller } = buildController();
      for (const handler of [controller.create, controller.update, controller.remove]) {
        const roles = Reflect.getMetadata(ROLES_KEY, handler);
        expect(roles).toContain('manager');
        expect(roles).toContain('admin');
        expect(roles).not.toContain('user');
      }
    });
  });
});
