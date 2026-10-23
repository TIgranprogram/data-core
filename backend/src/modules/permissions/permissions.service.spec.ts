import { PERMISSIONS } from '../../common/seed/permissions.constants';
import { PermissionsService } from './permissions.service';

/** PermissionsService: идемпотентный сид каталога прав и выборки. */
function chain<T>(value: T) {
  const c: Record<string, jest.Mock> = {};
  c.exec = jest.fn().mockResolvedValue(value);
  c.sort = jest.fn().mockReturnValue(c);
  c.select = jest.fn().mockReturnValue(c);
  c.lean = jest.fn().mockReturnValue(c);
  return c;
}

function make() {
  const model = {
    bulkWrite: jest.fn().mockResolvedValue({ upsertedCount: 0, modifiedCount: 0 }),
    findOne: jest.fn(),
    find: jest.fn(),
  };
  return { model, service: new PermissionsService(model as never) };
}

describe('PermissionsService', () => {
  it('onModuleInit: upsert по key для каждого права каталога', async () => {
    const { model, service } = make();
    await service.onModuleInit();
    const ops = model.bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(PERMISSIONS.length);
    expect(ops[0].updateOne.upsert).toBe(true);
    expect(ops[0].updateOne.filter).toEqual({ key: PERMISSIONS[0].key });
    expect(ops[0].updateOne.update).toEqual({ $set: { ...PERMISSIONS[0] } });
  });

  it('каталог прав без дубликатов ключей и в формате section:action', () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of PERMISSIONS) {
      expect(p.key).toBe(`${p.section}:${p.action}`);
    }
  });

  it('getByKey ищет по ключу', async () => {
    const { model, service } = make();
    model.findOne.mockReturnValue(chain({ key: 'user:read' }));
    await expect(service.getByKey('user:read')).resolves.toEqual({ key: 'user:read' });
    expect(model.findOne).toHaveBeenCalledWith({ key: 'user:read' });
  });

  it('getByKey: неизвестный ключ -> null', async () => {
    const { model, service } = make();
    model.findOne.mockReturnValue(chain(null));
    await expect(service.getByKey('nope:read')).resolves.toBeNull();
  });

  it('getBySection фильтрует по разделу', async () => {
    const { model, service } = make();
    model.find.mockReturnValue(chain([]));
    await service.getBySection('role');
    expect(model.find).toHaveBeenCalledWith({ section: 'role' });
  });

  it('getAll сортирует по section, action', async () => {
    const { model, service } = make();
    const c = chain([]);
    model.find.mockReturnValue(c);
    await service.getAll();
    expect(c.sort).toHaveBeenCalledWith({ section: 1, action: 1 });
  });

  it('getAllKeys возвращает только ключи', async () => {
    const { model, service } = make();
    model.find.mockReturnValue(chain([{ key: 'a:read' }, { key: 'b:write' }]));
    await expect(service.getAllKeys()).resolves.toEqual(['a:read', 'b:write']);
  });
});
