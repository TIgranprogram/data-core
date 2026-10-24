import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { userActivityCache } from '../../common/guards/user-activity-cache';
import { baseRoleOf, canSeeMoney, effectiveRoles, setCustomRoleBases } from '../../common/roles-hierarchy';
import { RoleService } from './role.service';

/** RoleService: уникальность имени, защита системных ролей, переименование. */
function chain<T>(value: T) {
  const c: Record<string, jest.Mock> = {};
  c.exec = jest.fn().mockResolvedValue(value);
  c.sort = jest.fn().mockReturnValue(c);
  return c;
}

function make() {
  const model = {
    findOne: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn().mockReturnValue(chain(undefined)),
    exists: jest.fn().mockResolvedValue(null),
    usersCount: jest.fn().mockResolvedValue(0),
    db: { collection: jest.fn() },
  };
  model.db.collection.mockImplementation(() => ({ countDocuments: model.usersCount }));
  const service = new RoleService(model as never);
  return { model, service };
}

function roleDoc(over: Record<string, unknown> = {}) {
  return {
    name: 'manager',
    isSystem: false,
    save: jest.fn().mockResolvedValue(undefined),
    deleteOne: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('RoleService', () => {
  describe('create', () => {
    it('дубликат имени -> 409', async () => {
      const { model, service } = make();
      model.findOne.mockReturnValue(chain({ name: 'x' }));
      await expect(service.create({ name: 'x', label: 'X' } as never)).rejects.toThrow(
        ConflictException,
      );
      expect(model.create).not.toHaveBeenCalled();
    });

    it('подставляет sortOrder=100 и isActive=true по умолчанию', async () => {
      const { model, service } = make();
      model.findOne.mockReturnValue(chain(null));
      model.create.mockImplementation(async (d: unknown) => d);
      await service.create({ name: 'x', label: 'X' } as never);
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'x', sortOrder: 100, isActive: true }),
      );
    });

    it('явные sortOrder и isActive=false сохраняются', async () => {
      const { model, service } = make();
      model.findOne.mockReturnValue(chain(null));
      model.create.mockImplementation(async (d: unknown) => d);
      await service.create({ name: 'x', label: 'X', sortOrder: 5, isActive: false } as never);
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ sortOrder: 5, isActive: false }),
      );
    });
  });

  describe('findAll / findByName', () => {
    it('findAll сортирует по sortOrder, name', async () => {
      const { model, service } = make();
      const c = chain([]);
      model.find.mockReturnValue(c);
      await service.findAll();
      expect(c.sort).toHaveBeenCalledWith({ sortOrder: 1, name: 1 });
    });

    it('findByName ищет по имени и возвращает null, если нет', async () => {
      const { model, service } = make();
      model.findOne.mockReturnValue(chain(null));
      await expect(service.findByName('zzz')).resolves.toBeNull();
      expect(model.findOne).toHaveBeenCalledWith({ name: 'zzz' });
    });
  });

  describe('findById', () => {
    it('нет роли -> 404', async () => {
      const { model, service } = make();
      model.findById.mockReturnValue(chain(null));
      await expect(service.findById('1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('нет роли -> 404', async () => {
      const { model, service } = make();
      model.findById.mockReturnValue(chain(null));
      await expect(service.update('1', {} as never)).rejects.toThrow(NotFoundException);
    });

    it('без переименования: сохраняет, пользователей не трогает, сбрасывает кэш активности', async () => {
      const { model, service } = make();
      const doc = roleDoc();
      model.findById.mockReturnValue(chain(doc));
      const spy = jest.spyOn(userActivityCache, 'invalidateAll');
      await service.update('1', { label: 'Новая' } as never);
      expect(doc.save).toHaveBeenCalled();
      expect(model.updateMany).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('SK-8c: код роли менять нельзя -> 400, тот же код — можно', async () => {
      const { model, service } = make();
      const doc = roleDoc({ name: 'r-abc123', baseRole: 'manager' });
      model.findById.mockReturnValue(chain(doc));
      await expect(service.update('1', { name: 'new' } as never)).rejects.toThrow(BadRequestException);
      expect(doc.save).not.toHaveBeenCalled();
      await service.update('1', { name: 'r-abc123', label: ' Кладовщик ' } as never);
      expect((doc as Record<string, unknown>).label).toBe('Кладовщик');
      setCustomRoleBases([]);
    });

    it('встроенную роль нельзя выключить и нельзя менять её права -> 400; название и разделы — можно', async () => {
      const { model, service } = make();
      const doc = roleDoc({ name: 'admin', isSystem: true, permissions: ['*'] });
      model.findById.mockReturnValue(chain(doc));
      await expect(service.update('1', { isActive: false } as never)).rejects.toThrow(BadRequestException);
      await expect(service.update('1', { permissions: [] } as never)).rejects.toThrow(BadRequestException);
      await expect(service.update('1', { isSystem: false } as never)).rejects.toThrow(BadRequestException);
      expect(doc.save).not.toHaveBeenCalled();
      await service.update('1', { label: 'Админ', appSections: ['stock'], permissions: ['*'] } as never);
      expect(doc.save).toHaveBeenCalled();
    });

    it('SK-8c: «права как у» встроенной роли менять нельзя -> 400, название — можно', async () => {
      const { model, service } = make();
      const doc = roleDoc({ name: 'manager', isSystem: true });
      model.findById.mockReturnValue(chain(doc));
      await expect(service.update('1', { baseRole: 'director' } as never)).rejects.toThrow(BadRequestException);
      await service.update('1', { label: 'Менеджер' } as never);
      expect(doc.save).toHaveBeenCalledTimes(1);
    });

    it('SK-8c: у своей роли «права как у» нельзя стереть -> 400', async () => {
      const { model, service } = make();
      model.findById.mockReturnValue(chain(roleDoc({ name: 'r-abc123', baseRole: 'manager' })));
      await expect(service.update('1', { baseRole: null } as never)).rejects.toThrow(BadRequestException);
    });

    it('SK-8c: кэш baseRole обновляется после правки — права меняются сразу', async () => {
      const { model, service } = make();
      setCustomRoleBases([{ name: 'r-abc123', baseRole: 'manager' }]);
      expect(canSeeMoney({ role: 'r-abc123' })).toBe(false);
      model.findById.mockReturnValue(chain(roleDoc({ name: 'r-abc123', baseRole: 'manager' })));
      await service.update('1', { baseRole: 'accountant' } as never);
      expect(baseRoleOf('r-abc123')).toBe('accountant');
      expect(canSeeMoney({ role: 'r-abc123' })).toBe(true);
      setCustomRoleBases([]);
    });
  });

  describe('remove', () => {
    it('системную роль удалить нельзя -> 409', async () => {
      const { model, service } = make();
      const doc = roleDoc({ isSystem: true, name: 'admin' });
      model.findById.mockReturnValue(chain(doc));
      await expect(service.remove('1')).rejects.toThrow(ConflictException);
      expect(doc.deleteOne).not.toHaveBeenCalled();
    });

    it('свою роль без сотрудников удаляет и убирает из кэша', async () => {
      const { model, service } = make();
      setCustomRoleBases([{ name: 'r-abc123', baseRole: 'manager' }]);
      const doc = roleDoc({ name: 'r-abc123', baseRole: 'manager' });
      model.findById.mockReturnValue(chain(doc));
      await service.remove('1');
      expect(model.usersCount).toHaveBeenCalledWith({ role: 'r-abc123' });
      expect(doc.deleteOne).toHaveBeenCalled();
      expect(effectiveRoles('r-abc123')).toEqual(['r-abc123']);
    });

    it('SK-8c: встроенную роль (даже без isSystem) удалить нельзя -> 409', async () => {
      const { model, service } = make();
      model.findById.mockReturnValue(chain(roleDoc({ name: 'manager' })));
      await expect(service.remove('1')).rejects.toThrow(ConflictException);
    });

    it('SK-8c: роль назначена сотрудникам -> 409 с числом', async () => {
      const { model, service } = make();
      const doc = roleDoc({ name: 'r-abc123', baseRole: 'manager' });
      model.findById.mockReturnValue(chain(doc));
      model.usersCount.mockResolvedValue(3);
      await expect(service.remove('1')).rejects.toThrow('Роль назначена 3 сотрудникам');
      model.usersCount.mockResolvedValue(21);
      await expect(service.remove('1')).rejects.toThrow('Роль назначена 21 сотруднику');
      expect(doc.deleteOne).not.toHaveBeenCalled();
    });

    it('нет роли -> 404', async () => {
      const { model, service } = make();
      model.findById.mockReturnValue(chain(null));
      await expect(service.remove('1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('SK-8c: createCustom / resolveForAuth', () => {
    it('код r-… задаёт сервер, права не свои, не системная; кэш сразу знает baseRole', async () => {
      const { model, service } = make();
      model.findOne.mockReturnValue(chain(null));
      model.create.mockImplementation(async (d: unknown) => d);
      const doc = await service.createCustom({ label: 'Кладовщик', baseRole: 'manager', appSections: ['stock', 'requests'], permissions: ['*'], isSystem: true } as never);
      expect(doc.name).toMatch(/^r-[0-9a-f]{6}$/);
      expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ label: 'Кладовщик', baseRole: 'manager', permissions: [], isSystem: false, appSections: ['stock', 'requests'] }));
      expect(effectiveRoles(doc.name)).toEqual([doc.name, 'manager', 'user']);
      setCustomRoleBases([]);
    });

    it('без baseRole, с baseRole=admin или с name -> 400', async () => {
      const { service } = make();
      await expect(service.createCustom({ label: 'Икс' } as never)).rejects.toThrow(BadRequestException);
      await expect(service.createCustom({ label: 'Икс', baseRole: 'admin' } as never)).rejects.toThrow(BadRequestException);
      await expect(service.createCustom({ label: 'Икс', baseRole: 'manager', name: 'director' } as never)).rejects.toThrow(BadRequestException);
    });

    it('resolveForAuth: своя роль — права (access) от baseRole, встроенная — сама', async () => {
      const { model, service } = make();
      const own = { name: 'r-abc123', label: 'Кладовщик', baseRole: 'manager', permissions: [] };
      const mgr = { name: 'manager', permissions: ['app-data:read'], pages: ['p1'] };
      model.findOne.mockImplementation((q: { name: string }) => chain(q.name === 'r-abc123' ? own : q.name === 'manager' ? mgr : null));
      expect(await service.resolveForAuth('r-abc123')).toEqual({ role: own, access: mgr, baseRole: 'manager' });
      expect(await service.resolveForAuth('manager')).toEqual({ role: mgr, access: mgr, baseRole: 'manager' });
      setCustomRoleBases([]);
    });
  });
});
