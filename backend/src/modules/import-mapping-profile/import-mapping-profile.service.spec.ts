import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ImportMappingProfileService } from './import-mapping-profile.service';

const user = {
  id: '507f1f77bcf86cd799439011',
  username: 'manager',
  role: 'manager',
  organizationId: '507f1f77bcf86cd799439022',
};

function modelWith(overrides: Record<string, unknown> = {}) {
  const updateMany = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
  const find = jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) });
  const findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
  return {
    create: jest.fn(),
    updateMany,
    find,
    findOne,
    ...overrides,
  } as any;
}

describe('ImportMappingProfileService (TZD-37)', () => {
  it('lists only the current organization and defaults first', async () => {
    const model = modelWith();
    const service = new ImportMappingProfileService(model);
    await service.list(user);
    expect(model.find).toHaveBeenCalledWith({ organizationId: expect.anything() });
  });

  it('requires an organization for profile storage', async () => {
    const service = new ImportMappingProfileService(modelWith());
    await expect(service.list({ ...user, organizationId: undefined })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('clears the previous default before creating a default profile', async () => {
    const create = jest.fn().mockResolvedValue({ name: 'X' });
    const model = modelWith({ create });
    const service = new ImportMappingProfileService(model);
    await service.create(
      { name: 'X', columnMap: { Артикул: 'article' }, isDefault: true },
      user,
    );
    expect(model.updateMany).toHaveBeenCalledWith(
      { organizationId: expect.anything(), isDefault: true },
      { $set: { isDefault: false } },
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'X', isDefault: true, targetEntity: 'material' }),
    );
  });

  it('updates a default and unsets other defaults', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: { toString: () => '507f1f77bcf86cd799439033' },
      name: 'Old',
      isDefault: false,
      save,
    };
    const model = modelWith({
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) }),
    });
    const service = new ImportMappingProfileService(model);
    await service.update('507f1f77bcf86cd799439033', { isDefault: true, name: 'New' }, user);
    expect(model.updateMany).toHaveBeenCalled();
    expect(doc.name).toBe('New');
    expect(doc.isDefault).toBe(true);
    expect(save).toHaveBeenCalled();
  });

  it('stores a multi-table profile (tables) verbatim', async () => {
    const create = jest.fn().mockResolvedValue({ name: 'Метод' });
    const model = modelWith({ create });
    const service = new ImportMappingProfileService(model);
    await service.create(
      {
        name: 'СолидВоркс',
        tables: [
          { targetEntity: 'product', columnMap: { Обозначение: 'sku', Наименование: 'name' } },
          { targetEntity: 'counterparty', columnMap: { Контрагент: 'name', ИНН: 'inn' } },
        ],
      },
      user,
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'СолидВоркс',
        tables: [
          { targetEntity: 'product', columnMap: { Обозначение: 'sku', Наименование: 'name' } },
          { targetEntity: 'counterparty', columnMap: { Контрагент: 'name', ИНН: 'inn' } },
        ],
      }),
    );
  });

  it('derives a single-table profile from legacy columnMap + targetEntity', async () => {
    const create = jest.fn().mockResolvedValue({ name: 'X' });
    const model = modelWith({ create });
    const service = new ImportMappingProfileService(model);
    await service.create(
      { name: 'X', columnMap: { Артикул: 'article' }, targetEntity: 'material' },
      user,
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        tables: [{ targetEntity: 'material', columnMap: { Артикул: 'article' } }],
      }),
    );
  });

  it('updates tables of an existing profile', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: { toString: () => '507f1f77bcf86cd799439044' },
      isDefault: false,
      save,
    };
    const model = modelWith({
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) }),
    });
    const service = new ImportMappingProfileService(model);
    const tables = [{ targetEntity: 'module' as const, columnMap: { Обозначение: 'article' } }];
    await service.update('507f1f77bcf86cd799439044', { tables }, user);
    expect(doc.tables).toEqual(tables);
    expect(save).toHaveBeenCalled();
  });

  it('maps duplicate key to a Russian conflict', async () => {
    const model = modelWith({ create: jest.fn().mockRejectedValue({ code: 11000 }) });
    const service = new ImportMappingProfileService(model);
    await expect(
      service.create({ name: 'X', columnMap: { Артикул: 'article' } }, user),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an empty profile (no tables and no columnMap) (TZD-48)', async () => {
    const service = new ImportMappingProfileService(modelWith());
    await expect(service.create({ name: 'Пусто' }, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an update that would empty a profile (TZD-48)', async () => {
    const doc: any = {
      _id: { toString: () => '507f1f77bcf86cd799439055' },
      isDefault: false,
      save: jest.fn(),
    };
    const model = modelWith({
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) }),
    });
    const service = new ImportMappingProfileService(model);
    await expect(service.update('507f1f77bcf86cd799439055', { tables: [] }, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('normalizes legacy columnMap on update into tables (single SoT) (TZD-48)', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: { toString: () => '507f1f77bcf86cd799439066' },
      isDefault: false,
      columnMap: { Старый: 'article' },
      targetEntity: 'material',
      tables: [{ targetEntity: 'material', columnMap: { Старый: 'article' } }],
      save,
    };
    const model = modelWith({
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) }),
    });
    const service = new ImportMappingProfileService(model);
    await service.update(
      '507f1f77bcf86cd799439066',
      { columnMap: { Артикул: 'article' }, targetEntity: 'material' },
      user,
    );
    expect(doc.tables).toEqual([{ targetEntity: 'material', columnMap: { Артикул: 'article' } }]);
    expect(doc.columnMap).toEqual({ Артикул: 'article' });
    expect(save).toHaveBeenCalled();
  });

  it('returns not found for invalid or foreign profile ids', async () => {
    const service = new ImportMappingProfileService(modelWith());
    await expect(service.update('bad-id', { name: 'X' }, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
