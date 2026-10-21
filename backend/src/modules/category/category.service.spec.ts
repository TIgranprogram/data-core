import { CategoryService } from './category.service';
import { BadRequestException, ConflictException } from '@nestjs/common';

function category(overrides: Record<string, unknown> = {}): any {
  const value: any = {
    _id: { toString: () => String(overrides['_id'] ?? 'cat-1') },
    id: String(overrides['_id'] ?? 'cat-1'),
    name: 'Металлы',
    slug: 'metals',
    type: 'material',
    fullPath: 'Металлы',
    parentId: undefined,
    skuPrefix: 'MTL',
    sortOrder: 1,
    isActive: true,
    toObject: () => ({ ...value }),
    save: jest.fn(),
    ...overrides,
  };
  if (overrides['_id'] && typeof overrides['_id'] === 'string') {
    value._id = { toString: () => overrides['_id'] as string };
  }
  value.save.mockResolvedValue(value);
  return value;
}

describe('CategoryService (CATALOG-377)', () => {
  function setup() {
    const parent = category({
      _id: '507f1f77bcf86cd799439011',
      id: '507f1f77bcf86cd799439011',
      name: 'Металлы',
      fullPath: 'Металлы',
    });
    const child = category({
      _id: '507f1f77bcf86cd799439012',
      id: '507f1f77bcf86cd799439012',
      name: 'Лист',
      slug: 'sheet',
      parentId: { toString: () => '507f1f77bcf86cd799439011' },
      // slug-era path — rename must still yield name segments
      fullPath: 'metals/sheet',
    });
    const model: any = {
      create: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      bulkWrite: jest.fn().mockResolvedValue({}),
      db: { collection: jest.fn() },
    };
    const service = new CategoryService(model);
    return { service, model, parent, child };
  }

  it('creates root and child fullPath from names, never slugs', async () => {
    const { service, model, parent } = setup();
    model.create.mockResolvedValue(category({ name: 'Пластик', slug: 'plastic', fullPath: 'Пластик' }));

    await service.create({ name: 'Пластик', slug: 'plastic', type: 'material', skuPrefix: 'PLS' }, null);
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ fullPath: 'Пластик' }));

    model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(parent) });
    model.create.mockResolvedValue(category({ name: 'Лист', slug: 'sheet', fullPath: 'Металлы/Лист' }));
    await service.create(
      { name: 'Лист', slug: 'sheet', type: 'material', skuPrefix: 'SHT', parentId: '507f1f77bcf86cd799439011' },
      null,
    );
    expect(model.create).toHaveBeenLastCalledWith(expect.objectContaining({ fullPath: 'Металлы/Лист' }));
  });

  it('renames a parent using name segments and updates descendant paths', async () => {
    const { service, model, parent, child } = setup();
    // findById for update target, then again inside rebuildDescendantFullPaths
    model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(parent) });
    // BFS: children under renamed parent once, then empty under the child
    model.find
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([child]) })
      .mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    await service.update('507f1f77bcf86cd799439011', { name: 'Сплавы' }, null);

    expect(parent.name).toBe('Сплавы');
    expect(parent.fullPath).toBe('Сплавы');
    expect(parent.save).toHaveBeenCalled();
    expect(model.bulkWrite).toHaveBeenCalledWith([
      {
        updateOne: {
          filter: { _id: child._id },
          update: { $set: { fullPath: 'Сплавы/Лист' } },
        },
      },
    ]);
  });

  it('persists a module-type category (TZ-NX-REG-CATEGORIES-CRUD)', async () => {
    const { service, model } = setup();
    model.create.mockResolvedValue(category({ name: 'Модули сборки', slug: 'assembly-modules', type: 'module', fullPath: 'Модули сборки' }));

    await service.create({ name: 'Модули сборки', slug: 'assembly-modules', type: 'module', skuPrefix: 'MOD' }, null);

    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'module' }));
  });

  it('rejects moving a category under its own descendant', async () => {
    const { service, model, parent } = setup();
    model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(parent) });
    await expect(
      service.update('507f1f77bcf86cd799439011', { parentId: '507f1f77bcf86cd799439011' }, null),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('duplicate key -> 409, not a raw 500 (TZ-NX-CATEGORY-DUPLICATE-SLUG-409)', () => {
    it('create() maps a duplicate {type, slug} to a readable ConflictException', async () => {
      const { service, model } = setup();
      model.create.mockRejectedValue({ code: 11000, keyPattern: { type: 1, slug: 1 } });

      await expect(
        service.create({ name: 'Дубликат', slug: 'metals', type: 'material', skuPrefix: 'DUP' }, null),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        message: 'Категория с таким названием уже существует для этого типа',
      });
    });

    it('create() maps a duplicate skuPrefix to its own readable ConflictException', async () => {
      const { service, model } = setup();
      model.create.mockRejectedValue({ code: 11000, keyPattern: { skuPrefix: 1 } });

      await expect(
        service.create({ name: 'Другое имя', slug: 'other-slug', type: 'material', skuPrefix: 'MTL' }, null),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        message: 'Префикс SKU уже используется другой категорией',
      });
    });

    it('update() maps a duplicate {type, slug} to a readable ConflictException, not a raw 500', async () => {
      const { service, model, parent } = setup();
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(parent) });
      parent.save.mockRejectedValueOnce({ code: 11000, keyPattern: { type: 1, slug: 1 } });

      await expect(
        service.update('507f1f77bcf86cd799439011', { slug: 'taken-slug' }, null),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        message: 'Категория с таким названием уже существует для этого типа',
      });
    });

    it('re-throws a non-duplicate-key error unchanged', async () => {
      const { service, model } = setup();
      model.create.mockRejectedValue(new Error('unexpected db error'));

      await expect(
        service.create({ name: 'X', slug: 'x', type: 'material', skuPrefix: 'X1' }, null),
      ).rejects.toThrow('unexpected db error');
    });
  });
});
