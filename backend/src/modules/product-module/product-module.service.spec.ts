import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProductModuleService, UpsertProductModuleDto, MaterialInModuleDto } from './product-module.service';

const MATERIAL_ID = new Types.ObjectId().toString();
/** TZ-NX-REG-CATEGORY-WIRE-MODULES — a valid module-type category, reused by every test that doesn't specifically test category rejection. */
const CATEGORY_ID = new Types.ObjectId().toString();
const MODULE_CATEGORY = { _id: new Types.ObjectId(CATEGORY_ID), name: 'Модули', type: 'module', isActive: true, deletedAt: null };
function query<T>(value: T) {
  return { select: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}
function graphStub() {
  return { assertNoCycleAndDepth: jest.fn().mockResolvedValue(undefined) };
}
function serviceWith(materials: unknown[], categoryDoc: unknown = MODULE_CATEGORY) {
  const model = {
    create: jest.fn().mockResolvedValue({ materials: [] }),
    findById: jest.fn(),
  } as any;
  const productModel = {} as any;
  const materialModel = { find: jest.fn().mockReturnValue(query(materials)) } as any;
  const categoryModel = { findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(categoryDoc) }) } as any;
  const compositionLines = {
    toStoredLine: jest.fn((dto: any, existing?: any) => ({
      _id: existing?._id ?? new Types.ObjectId(),
      lineType: dto.lineType ?? existing?.lineType ?? 'material',
      refId: new Types.ObjectId(String(dto.refId ?? existing?.refId ?? MATERIAL_ID)),
      quantity: dto.quantity ?? existing?.quantity ?? 1,
      sortOrder: dto.sortOrder ?? existing?.sortOrder ?? 0,
      unit: dto.unit ?? existing?.unit,
      overrideDimensions: dto.overrideDimensions ?? existing?.overrideDimensions,
      isPurchased: dto.isPurchased ?? existing?.isPurchased,
    })),
    validateReference: jest.fn().mockResolvedValue(undefined),
    upsertDeduplicated: jest.fn((_current: unknown[], incoming: unknown) => [incoming]),
    ensureLineLimit: jest.fn(),
    ensureNoDuplicateKeys: jest.fn(),
    dualRead: jest.fn((owner: { composition?: unknown[] }, legacy: unknown[]) =>
      owner.composition?.length ? owner.composition : legacy,
    ),
  };
  return {
    service: new ProductModuleService(model, productModel, materialModel, categoryModel, compositionLines as any, graphStub() as any, {
      previewModuleCost: jest.fn(),
    } as any),
    model,
    materialModel,
    categoryModel,
  };
}
function legacyMaterialsDto(overrideDimensions?: MaterialInModuleDto['overrideDimensions']): UpsertProductModuleDto {
  return { name: 'Тестовый модуль', article: 'MOD-TEST', categoryId: CATEGORY_ID, materials: [{ materialId: MATERIAL_ID, quantity: 1, overrideDimensions }] };
}

describe('ProductModuleService (TZ-CATALOG-304 + TZ-MATERIALS-309)', () => {
  it('rejects a missing article before creating a module (TZ-CATALOG-338)', async () => {
    const { service, model } = serviceWith([]);
    await expect(service.create({ name: 'Без артикула', article: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('maps duplicate module articles to a Russian conflict (TZ-CATALOG-338)', async () => {
    const { service, model } = serviceWith([]);
    model.create.mockRejectedValueOnce({ code: 11000, keyPattern: { organizationId: 1, article: 1 } });
    await expect(service.create({ name: 'Дубликат', article: 'MOD-DUP', categoryId: CATEGORY_ID })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'Артикул уже используется',
    });
  });

  it('rejects non-empty legacy materials[] on create', async () => {
    const { service, model } = serviceWith([]);
    await expect(service.create(legacyMaterialsDto({ length: 900 }))).rejects.toBeInstanceOf(BadRequestException);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('rejects non-empty legacy materials[] on update', async () => {
    const save = jest.fn();
    const doc = { _id: new Types.ObjectId(), save, workTypes: [], materials: [] };
    const { service, materialModel } = serviceWith([]);
    (service as any).model.findById.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(doc),
    });
    await expect(service.update('507f1f77bcf86cd799439011', legacyMaterialsDto({ width: 40 }))).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
    expect(materialModel.find).not.toHaveBeenCalled();
  });

  it('allows create when materials is omitted', async () => {
    const { service, model } = serviceWith([]);
    await expect(service.create({ name: 'Empty materials module', article: 'MOD-EMPTY', categoryId: CATEGORY_ID, workTypes: [] })).resolves.toBeDefined();
    expect(model.create).toHaveBeenCalledTimes(1);
  });

  it('allows create when materials is an empty array (treated as omit)', async () => {
    const { service, model } = serviceWith([]);
    await expect(service.create({ name: 'Empty array module', article: 'MOD-EMPTY-ARRAY', categoryId: CATEGORY_ID, materials: [], workTypes: [] })).resolves.toBeDefined();
    expect(model.create).toHaveBeenCalledTimes(1);
  });

  it('persists module↔workType binding days on create (TZ-NX-MODULE-WT-DAYS-SOT)', async () => {
    const { service, model } = serviceWith([]);
    const workTypeId = new Types.ObjectId().toString();
    await service.create({
      name: 'Дни на связке',
      article: 'MOD-DAYS',
      categoryId: CATEGORY_ID,
      workTypes: [{ workTypeId, estimatedHours: 8, days: 4 }],
    });
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ workTypes: [expect.objectContaining({ estimatedHours: 8, days: 4 })] }),
    );
  });

  it('defaults binding days to null when omitted so Gantt falls back to catalog (TZ-NX-MODULE-WT-DAYS-SOT)', async () => {
    const { service, model } = serviceWith([]);
    const workTypeId = new Types.ObjectId().toString();
    await service.create({ name: 'Без дней', article: 'MOD-NO-DAYS', categoryId: CATEGORY_ID, workTypes: [{ workTypeId, estimatedHours: 8 }] });
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ workTypes: [expect.objectContaining({ days: null })] }),
    );
  });

  it('rejects binding days below 1 (TZ-NX-MODULE-WT-DAYS-SOT)', async () => {
    const { service, model } = serviceWith([]);
    const workTypeId = new Types.ObjectId().toString();
    await expect(
      service.create({ name: 'Плохие дни', article: 'MOD-BAD-DAYS', categoryId: CATEGORY_ID, workTypes: [{ workTypeId, days: 0 }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('updates module↔workType binding days (TZ-NX-MODULE-WT-DAYS-SOT)', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const workTypeId = new Types.ObjectId().toString();
    const doc = { _id: new Types.ObjectId(), save, workTypes: [], materials: [] };
    const { service } = serviceWith([]);
    (service as any).model.findById.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(doc),
    });
    await service.update('507f1f77bcf86cd799439011', { workTypes: [{ workTypeId, days: 2 }] });
    expect(doc.workTypes).toEqual([expect.objectContaining({ days: 2 })]);
    expect(save).toHaveBeenCalled();
  });

  it('rejects immutable length override on composition material line', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc = { _id: new Types.ObjectId(), save, composition: [], materials: [] };
    const { service } = serviceWith([{
      _id: new Types.ObjectId(MATERIAL_ID),
      name: 'Лист',
      dimensions: [{ type: 'length', value: 1000, isImmutable: true }],
    }]);
    (service as any).model.findById.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(doc),
    });
    await expect(service.addComposition(String(doc._id), {
      lineType: 'material',
      refId: MATERIAL_ID,
      quantity: 1,
      overrideDimensions: { length: 900 },
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('allows mutable length override on composition material line', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc = { _id: new Types.ObjectId(), save, composition: [] as unknown[], materials: [] };
    const { service } = serviceWith([{
      _id: new Types.ObjectId(MATERIAL_ID),
      name: 'Лист',
      dimensions: [{ type: 'length', value: 1000, isImmutable: false }],
    }]);
    (service as any).model.findById.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(doc),
    });
    await expect(service.addComposition(String(doc._id), {
      lineType: 'material',
      refId: MATERIAL_ID,
      quantity: 1,
      overrideDimensions: { length: 900 },
    })).resolves.toBeDefined();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('rejects product lineType on module composition (TZ-CATALOG-305)', async () => {
    const save = jest.fn();
    const doc = { _id: new Types.ObjectId(), save, composition: [], materials: [] };
    const { service } = serviceWith([]);
    (service as any).model.findById.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(doc),
    });
    await expect(service.addComposition(String(doc._id), {
      lineType: 'product' as any,
      refId: new Types.ObjectId().toHexString(),
      quantity: 1,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects product lineType on module composition update (TZ-CATALOG-305)', async () => {
    const save = jest.fn();
    const lineId = new Types.ObjectId().toHexString();
    const doc = { _id: new Types.ObjectId(), save, composition: [{ _id: new Types.ObjectId(lineId), lineType: 'material', refId: new Types.ObjectId(MATERIAL_ID), quantity: 1, sortOrder: 0 }], materials: [] };
    const { service } = serviceWith([]);
    (service as any).model.findById.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(doc),
    });
    await expect(service.updateComposition(String(doc._id), lineId, {
      lineType: 'product' as any,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('getComposition resolves populated legacy materials.materialId (module composition 500 fix)', async () => {
    const moduleId = new Types.ObjectId();
    const populatedMaterial = {
      _id: new Types.ObjectId(MATERIAL_ID),
      name: 'Лист',
      unit: 'm2',
      dimensions: [],
      materialKind: 'raw',
    };
    const doc = {
      _id: moduleId,
      deletedAt: null,
      composition: [] as unknown[],
      materials: [{ materialId: populatedMaterial, quantity: 2, sortOrder: 0, unit: 'm2' }],
    };
    const { service } = serviceWith([]);
    (service as any).model.findById.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(doc),
    });
    const lines = await service.getComposition(String(moduleId));
    expect(lines).toHaveLength(1);
    expect(lines[0].refId.toString()).toBe(MATERIAL_ID);
    expect(lines[0].quantity).toBe(2);
  });

  describe('categoryId (TZ-NX-REG-CATEGORY-WIRE-MODULES)', () => {
    it('rejects create without a categoryId', async () => {
      const { service, model } = serviceWith([]);
      await expect(service.create({ name: 'Без категории', article: 'MOD-NO-CAT' })).rejects.toMatchObject({
        constructor: BadRequestException,
        message: 'Категория модуля обязательна',
      });
      expect(model.create).not.toHaveBeenCalled();
    });

    it('rejects a categoryId whose Category.type is not module', async () => {
      const { service, model } = serviceWith([], { _id: new Types.ObjectId(CATEGORY_ID), name: 'Детали', type: 'material', isActive: true, deletedAt: null });
      await expect(
        service.create({ name: 'Не та категория', article: 'MOD-WRONG-TYPE', categoryId: CATEGORY_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('rejects a categoryId that does not exist', async () => {
      const { service, model } = serviceWith([], null);
      await expect(
        service.create({ name: 'Нет категории', article: 'MOD-MISSING-CAT', categoryId: CATEGORY_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('persists a valid module-type categoryId on create', async () => {
      const { service, model } = serviceWith([]);
      await service.create({ name: 'С категорией', article: 'MOD-WITH-CAT', categoryId: CATEGORY_ID });
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: new Types.ObjectId(CATEGORY_ID) }),
      );
    });

    it('does not require categoryId on update, but validates it when provided', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      const doc = { _id: new Types.ObjectId(), save, workTypes: [], materials: [] };
      const { service } = serviceWith([]);
      (service as any).model.findById.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(doc),
      });
      await service.update(String(doc._id), { name: 'Переименован' });
      expect(save).toHaveBeenCalled();
      expect((doc as any).categoryId).toBeUndefined();
    });

    it('rejects update when the provided categoryId is not type=module', async () => {
      const save = jest.fn();
      const doc = { _id: new Types.ObjectId(), save, workTypes: [], materials: [] };
      const { service } = serviceWith([], { _id: new Types.ObjectId(CATEGORY_ID), name: 'Изделия', type: 'product', isActive: true, deletedAt: null });
      (service as any).model.findById.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(doc),
      });
      await expect(
        service.update(String(doc._id), { categoryId: CATEGORY_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(save).not.toHaveBeenCalled();
    });
  });
});

describe('ProductModuleService.findAll — photos (TZ-NX-MODULE-LIST-POPULATE-PHOTOS)', () => {
  function buildService(model: Record<string, unknown>) {
    return new ProductModuleService(
      model as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      graphStub() as never,
      { previewModuleCost: jest.fn() } as never,
    );
  }

  /** Mimics find().populate()...sort().lean().exec() — every non-terminal method returns the chain. */
  function findChain(items: unknown[]) {
    const chain: Record<string, unknown> = {};
    for (const method of ['populate', 'sort', 'lean']) {
      chain[method] = jest.fn().mockReturnValue(chain);
    }
    chain.exec = jest.fn().mockResolvedValue(items);
    return chain;
  }

  const uploadsDir = join(process.cwd(), 'uploads', 'module-list-photos-test');
  const existingUrl = '/uploads/module-list-photos-test/real.png';
  const orphanUrl = '/uploads/module-list-photos-test/orphan.png';

  beforeAll(async () => {
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(join(uploadsDir, 'real.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  afterAll(async () => {
    await rm(uploadsDir, { recursive: true, force: true });
  });

  it('populates photoIds/mainPhotoId and blanks storageUrl for a photo whose file no longer exists on disk', async () => {
    const items = [
      {
        _id: new Types.ObjectId(),
        name: 'Каркас',
        photoIds: [{ _id: new Types.ObjectId(), storageUrl: orphanUrl }],
        mainPhotoId: { _id: new Types.ObjectId(), storageUrl: orphanUrl },
      },
      {
        _id: new Types.ObjectId(),
        name: 'Полка',
        photoIds: [{ _id: new Types.ObjectId(), storageUrl: existingUrl }],
        mainPhotoId: { _id: new Types.ObjectId(), storageUrl: existingUrl },
      },
    ];
    const find = jest.fn().mockReturnValue(findChain(items));
    const service = buildService({ find });

    const result = await service.findAll();

    expect(find).toHaveBeenCalledWith({ deletedAt: null });
    const [orphaned, real] = result as unknown as Array<{
      photoIds: Array<{ storageUrl: string }>;
      mainPhotoId: { storageUrl: string };
    }>;
    expect(orphaned.photoIds[0].storageUrl).toBe('');
    expect(orphaned.mainPhotoId.storageUrl).toBe('');
    expect(real.photoIds[0].storageUrl).toBe(existingUrl);
    expect(real.mainPhotoId.storageUrl).toBe(existingUrl);
  });

  it('returns an empty list untouched when no modules exist', async () => {
    const find = jest.fn().mockReturnValue(findChain([]));
    const service = buildService({ find });

    const result = await service.findAll();

    expect(result).toEqual([]);
  });
});
