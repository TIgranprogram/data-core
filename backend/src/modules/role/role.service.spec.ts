import { ConflictException, NotFoundException } from '@nestjs/common';
import { userActivityCache } from '../../common/guards/user-activity-cache';
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
  };
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

    it('при переименовании запускает updateMany со старым именем', async () => {
      const { model, service } = make();
      const doc = roleDoc({ name: 'old' });
      model.findById.mockReturnValue(chain(doc));
      await service.update('1', { name: 'new' } as never);
      expect(doc.name).toBe('new');
      expect(model.updateMany).toHaveBeenCalledWith({ role: 'old' }, { role: 'new' });
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

    it('обычную роль удаляет', async () => {
      const { model, service } = make();
      const doc = roleDoc();
      model.findById.mockReturnValue(chain(doc));
      await service.remove('1');
      expect(doc.deleteOne).toHaveBeenCalled();
    });

    it('нет роли -> 404', async () => {
      const { model, service } = make();
      model.findById.mockReturnValue(chain(null));
      await expect(service.remove('1')).rejects.toThrow(NotFoundException);
    });
  });
});
