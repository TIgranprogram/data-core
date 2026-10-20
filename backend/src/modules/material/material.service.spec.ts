import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MaterialService } from './material.service';
import type { CreateMaterialDto } from './dto/create-material.dto';
import type { UpdateMaterialDto } from './dto/update-material.dto';
import type { CatalogGraphService } from '../catalog-graph/catalog-graph.service';

const CATEGORY_ID = new Types.ObjectId().toString();

function query<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function buildService(
  opts: {
    create?: jest.Mock;
    findById?: jest.Mock;
    findOne?: jest.Mock;
    updateOne?: jest.Mock;
    findOneAndUpdate?: jest.Mock;
    categoryFindById?: jest.Mock;
    counterNext?: jest.Mock;
    find?: jest.Mock;
    countDocuments?: jest.Mock;
  } = {},
) {
  const create = opts.create ?? jest.fn();
  const findById = opts.findById ?? jest.fn();
  const findOne = opts.findOne ?? jest.fn();
  const updateOne = opts.updateOne ?? jest.fn();
  const findOneAndUpdate = opts.findOneAndUpdate ?? jest.fn();
  const categoryFindById = opts.categoryFindById ?? jest.fn();
  const counterNext = opts.counterNext ?? jest.fn();
  const find = opts.find ?? jest.fn().mockReturnValue(findChain([]));
  const countDocuments = opts.countDocuments ?? jest.fn().mockReturnValue(query(0));
  const model = { create, findById, findOne, updateOne, findOneAndUpdate, find, countDocuments } as any;
  const categoryModel = { findById: categoryFindById } as any;
  const counter = { next: counterNext } as any;
  const catalogGraph = { getWhereUsed: jest.fn() } as unknown as CatalogGraphService;
  const service = new MaterialService(model, categoryModel, counter, catalogGraph, undefined);
  return { service, create, findById, findOne, updateOne, categoryFindById, counterNext, find, countDocuments };
}

/** Mimics the chained `find().populate()…lean().exec()` builder used by findAll. */
function findChain<T>(items: T[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ['populate', 'sort', 'skip', 'limit', 'lean']) {
    chain[method] = jest.fn().mockReturnValue(chain);
  }
  chain.exec = jest.fn().mockResolvedValue(items);
  return chain;
}

function dto(overrides: Partial<CreateMaterialDto> = {}): CreateMaterialDto {
  return {
    name: 'Стекло 4мм',
    article: 'STK-TEST',
    unit: 'm2',
    ...overrides,
  } as CreateMaterialDto;
}

function doc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId().toString(),
    name: 'Стекло 4мм',
    article: 'STK-TEST',
    unit: 'm2',
    save: jest.fn(),
    toObject() {
      // Spread top-level props except non-enumerable fields so the
      // service's destructure (`{ _id, sku, photoIds, ...copiable }`)
      // operates against plain keys. Mimics Mongoose's toObject().
      return { ...this };
    },
    ...overrides,
  };
}

describe('MaterialService (TZ-MATERIALS-303/307)', () => {
  describe('article contract (TZ-CATALOG-338)', () => {
    it('rejects a missing article before touching persistence', async () => {
      const { service, create } = buildService();
      await expect(service.create(dto({ article: '   ' }))).rejects.toBeInstanceOf(BadRequestException);
      expect(create).not.toHaveBeenCalled();
    });

    it('maps duplicate article index errors to a Russian conflict', async () => {
      const { service } = buildService({
        create: jest.fn().mockRejectedValue({ code: 11000, keyPattern: { organizationId: 1, article: 1 } }),
      });
      await expect(service.create(dto())).rejects.toMatchObject({
        constructor: ConflictException,
        message: 'Артикул уже используется',
      });
    });
  });

  describe('create', () => {
    it('persists the user-supplied sku without generating another code', async () => {
      const { service, create, categoryFindById, counterNext } = buildService({
        create: jest.fn().mockResolvedValue(doc({ sku: 'M-0001' })),
      });
      const result = await service.create(dto({ sku: 'M-0001', article: 'STK-004' }));

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ sku: 'M-0001', article: 'STK-004' }),
      );
      expect(categoryFindById).not.toHaveBeenCalled();
      expect(counterNext).not.toHaveBeenCalled();
      expect(result.sku).toBe('M-0001');
    });

    it('generates a server-side SKU from the material category when sku is omitted', async () => {
      const { service, create, categoryFindById, counterNext } = buildService({
        categoryFindById: jest.fn().mockReturnValue(
          query({
            _id: CATEGORY_ID,
            name: 'Листовые материалы',
            type: 'material',
            isActive: true,
            skuPrefix: 'SHEET',
          }),
        ),
        counterNext: jest.fn().mockResolvedValue('SHEET-2026-001'),
        create: jest.fn().mockResolvedValue(doc({ sku: 'SHEET-2026-001' })),
      });

      await service.create(dto({ categoryId: CATEGORY_ID }));

      expect(categoryFindById).toHaveBeenCalledWith(CATEGORY_ID);
      expect(counterNext).toHaveBeenCalledWith('Material', 'SHEET');
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ sku: 'SHEET-2026-001', categoryId: CATEGORY_ID }),
      );
    });

    it('rejects an unknown category before generating or creating a material', async () => {
      const { service, create, counterNext } = buildService({
        categoryFindById: jest.fn().mockReturnValue(query(null)),
      });

      await expect(service.create(dto({ categoryId: CATEGORY_ID }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(counterNext).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects an inactive or non-material category before generating a code', async () => {
      const { service, create, counterNext } = buildService({
        categoryFindById: jest.fn().mockReturnValue(
          query({
            _id: CATEGORY_ID,
            name: 'Категория продукта',
            type: 'product',
            isActive: false,
            skuPrefix: 'PRODUCT',
          }),
        ),
      });

      await expect(service.create(dto({ categoryId: CATEGORY_ID }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(counterNext).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects a category without a SKU prefix before creating a material', async () => {
      const { service, create, counterNext } = buildService({
        categoryFindById: jest.fn().mockReturnValue(
          query({
            _id: CATEGORY_ID,
            name: 'Без кода',
            type: 'material',
            isActive: true,
            skuPrefix: '',
          }),
        ),
      });

      await expect(service.create(dto({ categoryId: CATEGORY_ID }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(counterNext).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it('maps a Mongo duplicate-key (E11000) on create to 409 Conflict', async () => {
      const { service, create } = buildService({
        create: jest.fn().mockRejectedValue({ code: 11000, message: 'E11000 duplicate key' }),
      });

      await expect(service.create(dto({ sku: 'M-0001' }))).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('re-throws non-duplicate errors untouched', async () => {
      const { service } = buildService({
        create: jest.fn().mockRejectedValue(new Error('network down')),
      });
      await expect(service.create(dto())).rejects.toThrow('network down');
    });

    it('normalizes material colors before persistence', async () => {
      const { service, create } = buildService({
        create: jest.fn().mockResolvedValue(doc()),
      });

      await service.create(dto({ colors: [' Чёрный ', 'белый', 'чёрный', '   '] }));

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ colors: ['Чёрный', 'белый'] }),
      );
    });

    it('rejects duplicate dimension types on create', async () => {
      const { service, create } = buildService();
      await expect(
        service.create(
          dto({
            dimensions: [
              { type: 'thickness', value: 4 },
              { type: 'thickness', value: 6 },
            ],
          } as Partial<CreateMaterialDto>),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('findAll blanks orphaned photoIds/mainPhotoId.storageUrl (TZ-NX-DOCSTUDIO-VITRINA-PHOTO-BROKEN-IMG)', () => {
    const uploadsDir = join(process.cwd(), 'uploads', 'vitrina-material-test');
    const existingUrl = '/uploads/vitrina-material-test/real.png';
    const orphanUrl = '/uploads/vitrina-material-test/orphan.png';

    beforeAll(async () => {
      await mkdir(uploadsDir, { recursive: true });
      await writeFile(join(uploadsDir, 'real.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });

    afterAll(async () => {
      await rm(uploadsDir, { recursive: true, force: true });
    });

    it('blanks storageUrl for an orphaned mainPhotoId and a photoIds entry, keeps a real one intact', async () => {
      const items = [
        {
          _id: new Types.ObjectId(),
          name: 'Стекло',
          photoIds: [{ _id: new Types.ObjectId(), storageUrl: orphanUrl }],
          mainPhotoId: { _id: new Types.ObjectId(), storageUrl: orphanUrl },
        },
        {
          _id: new Types.ObjectId(),
          name: 'Профиль',
          photoIds: [{ _id: new Types.ObjectId(), storageUrl: existingUrl }],
          mainPhotoId: { _id: new Types.ObjectId(), storageUrl: existingUrl },
        },
      ];
      const { service } = buildService({ find: jest.fn().mockReturnValue(findChain(items)) });

      const result = await service.findAll({});

      const [orphaned, real] = result.items as unknown as Array<{
        photoIds: Array<{ storageUrl: string }>;
        mainPhotoId: { storageUrl: string };
      }>;
      expect(orphaned.photoIds[0].storageUrl).toBe('');
      expect(orphaned.mainPhotoId.storageUrl).toBe('');
      expect(real.photoIds[0].storageUrl).toBe(existingUrl);
      expect(real.mainPhotoId.storageUrl).toBe(existingUrl);
    });
  });

  describe('findAll category filter (TZ-SUPPLY-320)', () => {
    it('matches both the ObjectId and the legacy string form of categoryId', async () => {
      const { service, find, countDocuments } = buildService();

      await service.findAll({ categoryId: CATEGORY_ID });

      const [filter] = find.mock.calls[0] as [{ categoryId: { $in: unknown[] } }];
      expect(filter.categoryId.$in).toHaveLength(2);
      expect(filter.categoryId.$in[0]).toBeInstanceOf(Types.ObjectId);
      expect(filter.categoryId.$in[1]).toBe(CATEGORY_ID);
      expect(countDocuments).toHaveBeenCalledWith(expect.objectContaining({ categoryId: filter.categoryId }));
    });

    it('leaves the filter untouched when no category is requested', async () => {
      const { service, find } = buildService();

      await service.findAll({});

      const [filter] = find.mock.calls[0] as [Record<string, unknown>];
      expect(filter.categoryId).toBeUndefined();
    });
  });

  describe('update', () => {
    it('rejects duplicate dimension types on update', async () => {
      const save = jest.fn();
      const { service } = buildService({
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(doc({ save })),
        }),
      });
      await expect(
        service.update('507f1f77bcf86cd799439011', {
          dimensions: [
            { type: 'height', value: 10 },
            { type: 'height', value: 20 },
          ],
        } as UpdateMaterialDto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(save).not.toHaveBeenCalled();
    });

    it('normalizes colors on update while preserving an explicit empty list', async () => {
      const findOneAndUpdate = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(doc()),
      });
      const { service } = buildService({
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(doc()),
        }),
        findOneAndUpdate,
      });

      await service.update('507f1f77bcf86cd799439011', {
        colors: [' Красный ', 'красный', 'синий'],
      });

      expect(findOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $set: expect.objectContaining({ colors: ['Красный', 'синий'] }) }),
        expect.anything(),
      );
    });

    it('maps an E11000 raised by findOneAndUpdate to 409 Conflict (TZ-CATALOG-339)', async () => {
      // update() пишет через findOneAndUpdate (TZ-CATALOG-339) — регекс-тест
      // мокает именно его, а не doc.save() (старый путь устарел).
      const findOneAndUpdate = jest.fn().mockReturnValue({
        exec: jest.fn().mockRejectedValue({ code: 11000, message: 'E11000 duplicate key' }),
      });
      const { service } = buildService({
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(doc({})),
        }),
        findOneAndUpdate,
      });

      const updateDto: UpdateMaterialDto = { sku: 'M-0001' };
      await expect(service.update('507f1f77bcf86cd799439011', updateDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('casts FK ids to ObjectId so the ?categoryId= filter can match (TZ-SUPPLY-320)', async () => {
      const findOneAndUpdate = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(doc()),
      });
      const { service } = buildService({
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(doc()) }),
        categoryFindById: jest.fn().mockReturnValue(
          query({ _id: CATEGORY_ID, name: 'Комплектующие', type: 'material', isActive: true, skuPrefix: 'CMP' }),
        ),
        findOneAndUpdate,
      });

      await service.update('507f1f77bcf86cd799439011', { categoryId: CATEGORY_ID });

      const [, update] = findOneAndUpdate.mock.calls[0] as [unknown, { $set: Record<string, unknown> }];
      expect(update.$set.categoryId).toBeInstanceOf(Types.ObjectId);
      expect(String(update.$set.categoryId)).toBe(CATEGORY_ID);
    });

    it('keeps 404 behavior for a missing document (no save attempted)', async () => {
      const { service, findById } = buildService({
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(
        service.update('507f1f77bcf86cd799439011', { sku: 'M-0001' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(findById).toHaveBeenCalled();
    });
  });

  describe('duplicate (TZ-MATERIALS-310)', () => {
    const SRC = '507f1f77bcf86cd799439011';

    function sourceDoc(overrides: Record<string, unknown> = {}) {
      return doc({
        _id: SRC,
        name: 'Стекло 4мм',
        article: 'STK-004',
        sku: 'SHEET-2026-001',
        unit: 'm2',
        categoryId: new Types.ObjectId(),
        description: 'Листовое стекло',
        pricePerUnit: 1500,
        dimensions: [{ type: 'thickness', value: 4, isImmutable: true }],
        photoIds: [new Types.ObjectId(), new Types.ObjectId()],
        mainPhotoId: new Types.ObjectId(),
        supplierId: new Types.ObjectId(),
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-07-01'),
        organizationId: new Types.ObjectId(),
        isSystem: false,
        ...overrides,
      });
    }

    it('rejects an invalid ObjectId with NotFoundException', async () => {
      const { service } = buildService();
      await expect(service.duplicate('not-an-object-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects a missing source with NotFoundException', async () => {
      const { service } = buildService({
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      });
      await expect(service.duplicate(SRC)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('appends « (копия)» suffix to the source name', async () => {
      const { service, create, counterNext, categoryFindById } = buildService({
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(sourceDoc()) }),
        // Source has a categoryId; we want to verify safe-fallback when
        // category is missing: no sku generated but clone is still
        // created with the suffixed name.
        categoryFindById: jest.fn().mockReturnValue(query(null)),
        create: jest.fn().mockResolvedValue(doc({ name: 'Стекло 4мм (копия)' })),
      });

      const result = await service.duplicate(SRC);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Стекло 4мм (копия)' }),
      );
      // Safe-fallback: when category lookup resolves to null we do NOT
      // throw; counter is not called because category is not assignable.
      expect(categoryFindById).toHaveBeenCalled();
      expect(counterNext).not.toHaveBeenCalled();
      expect(result.name).toBe('Стекло 4мм (копия)');
    });

    it('truncates name to 256 chars when suffix would overflow the schema constraint', async () => {
      const longName = 'А'.repeat(256);
      const { service, create } = buildService({
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(sourceDoc({ name: longName })) }),
        categoryFindById: jest.fn().mockReturnValue(query(null)),
        create: jest.fn().mockImplementation((payload: Record<string, unknown>) =>
          Promise.resolve(doc({ name: payload.name as string })),
        ),
      });

      const result = await service.duplicate(SRC);

      expect((result.name as string).length).toBeLessThanOrEqual(256);
      expect((result.name as string).endsWith(' (копия)')).toBe(true);
      // First 247 chars are the original «А», rest is the suffix.
      expect(result.name.startsWith('А'.repeat(247))).toBe(true);
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: result.name }));
    });

    it('regenerates SKU through CounterService when source category has a skuPrefix', async () => {
      const srcCatId = new Types.ObjectId();
      const { service, create, categoryFindById, counterNext } = buildService({
        findById: jest
          .fn()
          .mockReturnValue({ exec: jest.fn().mockResolvedValue(sourceDoc({ categoryId: srcCatId })) }),
        categoryFindById: jest.fn().mockReturnValue(
          query({
            _id: srcCatId.toString(),
            name: 'Листовые материалы',
            type: 'material',
            isActive: true,
            skuPrefix: 'SHEET',
          }),
        ),
        counterNext: jest.fn().mockResolvedValue('SHEET-2026-002'),
        create: jest.fn().mockResolvedValue(doc({ sku: 'SHEET-2026-002' })),
      });

      await service.duplicate(SRC);

      expect(categoryFindById).toHaveBeenCalledWith(srcCatId.toString());
      expect(counterNext).toHaveBeenCalledWith('Material', 'SHEET');
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ sku: 'SHEET-2026-002', name: 'Стекло 4мм (копия)' }),
      );
    });

    it('does NOT copy photoIds / mainPhotoId (re-uploads required by user)', async () => {
      const { service, create } = buildService({
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(sourceDoc()) }),
        categoryFindById: jest.fn().mockReturnValue(query(null)),
        create: jest.fn().mockImplementation((payload: Record<string, unknown>) =>
          Promise.resolve(doc(payload)),
        ),
      });

      await service.duplicate(SRC);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          photoIds: [],
          mainPhotoId: undefined,
        }),
      );
    });

    it('drops the source sku (NEW sku is generated by Counter or left empty)', async () => {
      const { service, create } = buildService({
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(sourceDoc()) }),
        categoryFindById: jest.fn().mockReturnValue(query(null)),
        create: jest.fn().mockImplementation((payload: Record<string, unknown>) =>
          Promise.resolve(doc(payload)),
        ),
      });

      await service.duplicate(SRC);

      // Source sku «SHEET-2026-001» MUST NOT be carried over without
      // regeneration — that would defeat the whole point of unique codes.
      const passed = create.mock.calls[0][0] as Record<string, unknown>;
      expect('sku' in passed ? passed.sku : undefined).toBeUndefined();
    });

    it('leaves the clone sku-less if category lookup fails (safe-fallback policy)', async () => {
      const srcCatId = new Types.ObjectId();
      const { service, create, counterNext, categoryFindById } = buildService({
        findById: jest
          .fn()
          .mockReturnValue({ exec: jest.fn().mockResolvedValue(sourceDoc({ categoryId: srcCatId })) }),
        categoryFindById: jest.fn().mockReturnValue(query(null)), // category vanished
        create: jest.fn().mockImplementation((payload: Record<string, unknown>) =>
          Promise.resolve(doc(payload)),
        ),
      });

      await service.duplicate(SRC);

      expect(categoryFindById).toHaveBeenCalled();
      expect(counterNext).not.toHaveBeenCalled();
      const passed = create.mock.calls[0][0] as Record<string, unknown>;
      expect('sku' in passed ? passed.sku : undefined).toBeUndefined();
      expect(passed.name).toBe('Стекло 4мм (копия)');
    });

    it('maps E11000 on the create call of duplicate to 409 Conflict', async () => {
      const { service, create } = buildService({
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(sourceDoc()) }),
        categoryFindById: jest.fn().mockReturnValue(query(null)),
        create: jest.fn().mockRejectedValue({ code: 11000, message: 'E11000 duplicate key' }),
      });

      await expect(service.duplicate(SRC)).rejects.toBeInstanceOf(ConflictException);
      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  describe('getComposition (TZ-NX-DETAIL-MATERIAL-BOM)', () => {
    it('returns the stored composition array', async () => {
      const compositionLine = { _id: new Types.ObjectId(), lineType: 'material', refId: new Types.ObjectId(), quantity: 3, sortOrder: 0 };
      const { service } = buildService({
        findOne: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue({ composition: [compositionLine] }),
        }),
      });
      const result = await service.getComposition(new Types.ObjectId().toString());
      expect(result).toEqual([compositionLine]);
    });

    it('returns an empty array for a Деталь without composition yet', async () => {
      const { service } = buildService({
        findOne: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue({ composition: [] }),
        }),
      });
      const result = await service.getComposition(new Types.ObjectId().toString());
      expect(result).toEqual([]);
    });

    it('rejects a missing material with NotFoundException', async () => {
      const { service } = buildService({
        findOne: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(null),
        }),
      });
      await expect(service.getComposition(new Types.ObjectId().toString())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects an invalid id before querying', async () => {
      const { service, findOne } = buildService();
      await expect(service.getComposition('not-an-object-id')).rejects.toBeInstanceOf(NotFoundException);
      expect(findOne).not.toHaveBeenCalled();
    });
  });
});
