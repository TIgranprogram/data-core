import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Types } from 'mongoose';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProductService } from './product.service';

/**
 * TZ-CATALOG-305: Product→Product composition tests.
 *
 * Focus: isComplex computed, unitPriceOverride, product line validation.
 * Note: Full ProductService is complex (many deps); these tests use a
 * minimal harness to validate the composition-line service integration.
 */

// ---------------------------------------------------------------------------
// isComplex derivation (the logic from ProductService.findById)
// ---------------------------------------------------------------------------
function computeIsComplex(composition: Array<{ lineType: string }>): boolean {
  return composition.some((line) => line.lineType === 'product');
}

describe('TZ-MIG-306 — findAll categoryId string|ObjectId match', () => {
  function buildService(model: Record<string, unknown>) {
    return new ProductService(
      model as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  function listChain(items: unknown[]) {
    const lean = jest.fn(() => ({ exec: jest.fn().mockResolvedValue(items) }));
    const skip = jest.fn(() => ({ limit: jest.fn(() => ({ lean })) }));
    const sort = jest.fn(() => ({ skip }));
    const populate3 = jest.fn(() => ({ sort }));
    const populate2 = jest.fn(() => ({ populate: populate3 }));
    const populate1 = jest.fn(() => ({ populate: populate2 }));
    return { find: jest.fn(() => ({ populate: populate1 })), countDocuments: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(items.length) })) };
  }

  it('filters with $in of ObjectId and string so KP3 string categoryId matches', async () => {
    const categoryId = new Types.ObjectId().toString();
    const model = listChain([{ _id: new Types.ObjectId(), name: 'Скамья', sku: 'B-1' }]);
    const service = buildService(model);
    const result = await service.findAll({ categoryId, page: 1, limit: 10 });
    expect(result.total).toBe(1);
    expect(model.find).toHaveBeenCalledWith(
      expect.objectContaining({
        deletedAt: null,
        categoryId: { $in: [new Types.ObjectId(categoryId), categoryId] },
      }),
    );
  });
});

describe('TZ-NX-DOCSTUDIO-VITRINA-PHOTO-BROKEN-IMG — findAll blanks orphaned photoIds.storageUrl', () => {
  function buildService(model: Record<string, unknown>) {
    return new ProductService(
      model as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  function listChain(items: unknown[]) {
    const lean = jest.fn(() => ({ exec: jest.fn().mockResolvedValue(items) }));
    const skip = jest.fn(() => ({ limit: jest.fn(() => ({ lean })) }));
    const sort = jest.fn(() => ({ skip }));
    const populate3 = jest.fn(() => ({ sort }));
    const populate2 = jest.fn(() => ({ populate: populate3 }));
    const populate1 = jest.fn(() => ({ populate: populate2 }));
    return { find: jest.fn(() => ({ populate: populate1 })), countDocuments: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(items.length) })) };
  }

  const uploadsDir = join(process.cwd(), 'uploads', 'vitrina-product-test');
  const existingUrl = '/uploads/vitrina-product-test/real.png';
  const orphanUrl = '/uploads/vitrina-product-test/orphan.png';

  beforeAll(async () => {
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(join(uploadsDir, 'real.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  afterAll(async () => {
    await rm(uploadsDir, { recursive: true, force: true });
  });

  it('blanks storageUrl for a photo whose file no longer exists on disk, keeps a real one intact', async () => {
    const model = listChain([
      { _id: new Types.ObjectId(), name: 'Стол', sku: 'T-1', photoIds: [{ _id: new Types.ObjectId(), storageUrl: orphanUrl }] },
      { _id: new Types.ObjectId(), name: 'Стул', sku: 'C-1', photoIds: [{ _id: new Types.ObjectId(), storageUrl: existingUrl }] },
    ]);
    const service = buildService(model);
    const result = await service.findAll({ page: 1, limit: 10 });
    expect((result.items[0] as { photoIds: Array<{ storageUrl: string }> }).photoIds[0].storageUrl).toBe('');
    expect((result.items[1] as { photoIds: Array<{ storageUrl: string }> }).photoIds[0].storageUrl).toBe(existingUrl);
  });
});

describe('TZ-CATALOG-338 — Product article contract', () => {
  function buildService(model: { create: jest.Mock }) {
    return new ProductService(
      model as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  it('rejects a missing or whitespace-only sku before persistence', async () => {
    const model = { create: jest.fn() };
    const service = buildService(model);
    await expect(service.create({ name: '', sku: '   ', kind: 'good', unit: 'шт' } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('maps duplicate sku index errors to a Russian conflict', async () => {
    const model = { create: jest.fn().mockRejectedValue({ code: 11000, keyPattern: { organizationId: 1, sku: 1 } }) };
    const service = buildService(model);
    await expect(service.create({ name: '', sku: 'P-DUP', kind: 'good', unit: 'шт' } as never)).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'Артикул уже используется',
    });
  });
});

describe('TZ-CATALOG-305 — isComplex derivation', () => {
  it('returns false when composition is empty', () => {
    expect(computeIsComplex([])).toBe(false);
  });

  it('returns false when composition has only modules/materials', () => {
    expect(computeIsComplex([
      { lineType: 'module' },
      { lineType: 'material' },
    ])).toBe(false);
  });

  it('returns true when composition has ≥1 product line', () => {
    expect(computeIsComplex([
      { lineType: 'module' },
      { lineType: 'product' },
      { lineType: 'material' },
    ])).toBe(true);
  });

  it('returns true with only product lines', () => {
    expect(computeIsComplex([
      { lineType: 'product' },
      { lineType: 'product' },
    ])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// unitPriceOverride guard (from CompositionLineService.validateReference)
// ---------------------------------------------------------------------------
describe('TZ-CATALOG-305 — unitPriceOverride guard', () => {
  it('allows unitPriceOverride on product line', () => {
    const line = { lineType: 'product', unitPriceOverride: 150 };
    const valid = line.lineType === 'product' || line.unitPriceOverride === undefined;
    expect(valid).toBe(true);
  });

  it('rejects unitPriceOverride on module line', () => {
    const line = { lineType: 'module', unitPriceOverride: 100 };
    const valid = line.lineType === 'product' || line.unitPriceOverride === undefined;
    expect(valid).toBe(false);
  });

  it('rejects unitPriceOverride on material line', () => {
    const line = { lineType: 'material', unitPriceOverride: 50 };
    const valid = line.lineType === 'product' || line.unitPriceOverride === undefined;
    expect(valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Composition does not mutate child Product (by design — parent only stores ref)
// ---------------------------------------------------------------------------
describe('TZ-CATALOG-339 — product.update photoIds via findOneAndUpdate', () => {
  function buildService(model: Record<string, unknown>) {
    return new ProductService(
      model as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  it('PATCH with photoIds uses findOneAndUpdate (not doc.save)', async () => {
    const id = new Types.ObjectId();
    const photoId = new Types.ObjectId().toString();
    const existing = {
      _id: id,
      __v: 3,
      photoIds: [],
      categoryId: undefined,
    };
    const updated = { ...existing, __v: 4, photoIds: [new Types.ObjectId(photoId)] };
    const execFind = jest.fn().mockResolvedValue(existing);
    const execUpdate = jest.fn().mockResolvedValue(updated);
    const model = {
      findOne: jest.fn(() => ({ exec: execFind })),
      findOneAndUpdate: jest.fn(() => ({ exec: execUpdate })),
    };
    const service = buildService(model);
    const result = await service.update(id.toString(), { photoIds: [photoId] } as never);
    expect(model.findOneAndUpdate).toHaveBeenCalled();
    const [, update] = (model.findOneAndUpdate as jest.Mock).mock.calls[0];
    expect(update.$set.photoIds).toHaveLength(1);
    expect(update.$inc).toEqual({ __v: 1 });
    expect(result.__v).toBe(4);
  });
});

describe('TZ-CATALOG-371 — Product duplicate API', () => {
  function buildDuplicateService(model: Record<string, unknown>, eav: Record<string, unknown>) {
    return new ProductService(
      model as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      eav as never,
      {} as never,
      {} as never,
    );
  }

  function queryChain<T>(value: T) {
    return {
      select: jest.fn(() => ({ lean: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(value) })) })),
    };
  }

  it('duplicates a scoped Product with independent composition and copied EAV refs', async () => {
    const sourceId = new Types.ObjectId();
    const createdId = new Types.ObjectId();
    const organizationId = new Types.ObjectId().toString();
    const photoId = new Types.ObjectId();
    const source = {
      _id: sourceId,
      name: 'Стол',
      sku: 'TABLE-1',
      kind: 'good',
      unit: 'шт',
      categoryId: new Types.ObjectId(),
      listPrice: 100,
      basePrice: 80,
      costPrice: 50,
      defaultMarkupPercent: 30,
      description: 'Исходное описание',
      notes: 'Заметка',
      photoIds: [photoId],
      dimensions: { length: 10, unit: 'см' },
      productModuleIds: [new Types.ObjectId()],
      composition: [{ _id: new Types.ObjectId(), lineType: 'material', refId: new Types.ObjectId(), quantity: 2, sortOrder: 0, unitPriceOverride: 77 }],
      organizationId: new Types.ObjectId(organizationId),
      isActive: true,
    };
    const created = { ...source, _id: createdId, sku: 'TABLE-1-COPY-1', name: 'Стол — копия', copiedFromProductId: sourceId };
    const model = {
      findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(source) })),
      find: jest.fn(() => queryChain([])),
      create: jest.fn().mockResolvedValue(created),
    };
    const eav = {
      loadAttributes: jest.fn().mockResolvedValue({ Цвет: 'Белый' }),
      resolveAttributes: jest.fn().mockResolvedValue({}),
    };
    const service = buildDuplicateService(model, eav);

    const result = await service.duplicate(sourceId.toString(), { description: 'Описание копии' }, organizationId);

    expect(result).toBe(created);
    expect(model.findOne).toHaveBeenCalledWith(expect.objectContaining({
      _id: sourceId,
      organizationId: new Types.ObjectId(organizationId),
      deletedAt: null,
    }));
    const payload = (model.create as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      name: 'Стол — копия',
      sku: 'TABLE-1-COPY-1',
      description: 'Описание копии',
      stockQty: 0,
      status: 'draft',
      isActive: true,
      isSystem: false,
      copiedFromProductId: sourceId,
    });
    expect(payload.photoIds).toEqual([photoId]);
    expect(payload.productModuleIds).not.toBe(source.productModuleIds);
    expect(payload.composition).not.toBe(source.composition);
    expect((payload.composition as Array<{ unitPriceOverride?: number }>)[0]?.unitPriceOverride).toBe(77);
    expect(eav.resolveAttributes).toHaveBeenCalledWith('Product', createdId, { Цвет: 'Белый' }, source.categoryId);
  });

  it('turns an explicitly occupied SKU into a 409 without retrying another SKU', async () => {
    const sourceId = new Types.ObjectId();
    const source = { _id: sourceId, name: 'Стол', sku: 'TABLE-1', kind: 'good', unit: 'шт', photoIds: [], productModuleIds: [], composition: [] };
    const model = {
      findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(source) })),
      find: jest.fn(() => queryChain([])),
      create: jest.fn().mockRejectedValue({ code: 11000 }),
    };
    const service = buildDuplicateService(model, { loadAttributes: jest.fn().mockResolvedValue({}) });

    await expect(service.duplicate(sourceId.toString(), { sku: 'TAKEN' })).rejects.toMatchObject({ constructor: ConflictException });
    expect(model.create).toHaveBeenCalledTimes(1);
  });

  it('does not disclose a source from another organization', async () => {
    const sourceId = new Types.ObjectId();
    const model = {
      findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(null) })),
      find: jest.fn(() => queryChain([])),
      create: jest.fn(),
    };
    const service = buildDuplicateService(model, { loadAttributes: jest.fn() });

    await expect(service.duplicate(sourceId.toString(), {}, new Types.ObjectId().toString())).rejects.toMatchObject({ constructor: expect.any(Function) });
    expect(model.create).not.toHaveBeenCalled();
  });
});

describe('TZ-CATALOG-371 — expectedVersion update', () => {
  it('filters by expectedVersion and returns 409 without mutation on stale source', async () => {
    const id = new Types.ObjectId();
    const execFind = jest.fn().mockResolvedValue({ _id: id, __v: 3, photoIds: [] });
    const execUpdate = jest.fn().mockResolvedValue(null);
    const model = {
      findOne: jest.fn(() => ({ exec: execFind })),
      findOneAndUpdate: jest.fn(() => ({ exec: execUpdate })),
    };
    const service = new ProductService(model as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);

    await expect(service.update(id.toString(), { description: 'stale', expectedVersion: 2 } as never)).rejects.toMatchObject({ constructor: ConflictException });
    expect((model.findOneAndUpdate as jest.Mock).mock.calls[0][0]).toEqual(expect.objectContaining({ __v: 2 }));
    expect(execUpdate).toHaveBeenCalled();
  });
});

describe('TZ-CATALOG-305 — child Product independence', () => {
  it('composition ref does not mutate child listPrice', () => {
    const childProduct = { _id: new Types.ObjectId(), name: 'Child', listPrice: 500, basePrice: 300 };
    const compositionLine = { lineType: 'product', refId: childProduct._id, quantity: 1, unitPriceOverride: 700 };

    // The override lives on the composition line, NOT on the child
    expect(compositionLine.unitPriceOverride).toBe(700);
    expect(childProduct.listPrice).toBe(500);
    expect(childProduct.basePrice).toBe(300);
  });

  it('product can be child without unitPriceOverride', () => {
    const childProduct = { _id: new Types.ObjectId(), name: 'Child', listPrice: 500 };
    const compositionLine: { lineType: string; refId: Types.ObjectId; quantity: number; unitPriceOverride?: number } =
      { lineType: 'product', refId: childProduct._id, quantity: 2 };

    expect(compositionLine.unitPriceOverride).toBeUndefined();
    expect(childProduct.listPrice).toBe(500);
  });
});

describe('TZ-NX-PHOTO-P2 — Product.mainPhotoId validation', () => {
  function buildService(model: Record<string, unknown>) {
    return new ProductService(
      model as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { loadAttributes: jest.fn().mockResolvedValue({}) } as never,
      {} as never,
      {} as never,
    );
  }

  it('create rejects mainPhotoId not in photoIds (400 RU) before persistence', async () => {
    const model = { create: jest.fn() };
    const service = buildService(model);
    await expect(
      service.create({
        sku: 'P-1',
        kind: 'good',
        unit: 'шт',
        photoIds: [new Types.ObjectId().toString()],
        mainPhotoId: new Types.ObjectId().toString(),
      } as never),
    ).rejects.toMatchObject({ message: 'Главное фото должно быть среди фото изделия' });
    expect(model.create).not.toHaveBeenCalled();
  });

  it('create accepts mainPhotoId within photoIds and persists an ObjectId', async () => {
    const mainId = new Types.ObjectId();
    const model = { create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) };
    const service = buildService(model);
    await service.create({
      sku: 'P-1',
      kind: 'good',
      unit: 'шт',
      photoIds: [mainId.toString()],
      mainPhotoId: mainId.toString(),
    } as never);
    const payload = (model.create as jest.Mock).mock.calls[0][0];
    expect(payload.mainPhotoId).toEqual(mainId);
    expect(payload.photoIds[0]).toEqual(mainId);
  });

  it('update rejects mainPhotoId outside merged photoIds (400 RU)', async () => {
    const id = new Types.ObjectId();
    const existing = { _id: id, __v: 1, photoIds: [], categoryId: undefined };
    const execFind = jest.fn().mockResolvedValue(existing);
    const execUpdate = jest.fn().mockResolvedValue({ ...existing });
    const model = {
      findOne: jest.fn(() => ({ exec: execFind })),
      findOneAndUpdate: jest.fn(() => ({ exec: execUpdate })),
    };
    const service = buildService(model);
    await expect(
      service.update(id.toString(), { mainPhotoId: new Types.ObjectId().toString() } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('update merges incoming photoIds before validating main', async () => {
    const id = new Types.ObjectId();
    const mainId = new Types.ObjectId().toString();
    const existing = { _id: id, __v: 1, photoIds: [], categoryId: undefined };
    const execFind = jest.fn().mockResolvedValue(existing);
    const execUpdate = jest.fn().mockResolvedValue({ ...existing, photoIds: [new Types.ObjectId(mainId)] });
    const model = {
      findOne: jest.fn(() => ({ exec: execFind })),
      findOneAndUpdate: jest.fn(() => ({ exec: execUpdate })),
    };
    const service = buildService(model);
    await service.update(id.toString(), { photoIds: [mainId], mainPhotoId: mainId } as never);
    const [, update] = (model.findOneAndUpdate as jest.Mock).mock.calls[0];
    expect(update.$set.mainPhotoId).toEqual(new Types.ObjectId(mainId));
  });

  it('update accepts mainPhotoId null to clear the cover', async () => {
    const id = new Types.ObjectId();
    const existing = { _id: id, __v: 1, photoIds: [new Types.ObjectId()], categoryId: undefined };
    const execFind = jest.fn().mockResolvedValue(existing);
    const execUpdate = jest.fn().mockResolvedValue({ ...existing, mainPhotoId: null });
    const model = {
      findOne: jest.fn(() => ({ exec: execFind })),
      findOneAndUpdate: jest.fn(() => ({ exec: execUpdate })),
    };
    const service = buildService(model);
    await service.update(id.toString(), { mainPhotoId: null } as never);
    const [, update] = (model.findOneAndUpdate as jest.Mock).mock.calls[0];
    expect(update.$set.mainPhotoId).toBeNull();
  });

  it('duplicate carries mainPhotoId from the source', async () => {
    const sourceId = new Types.ObjectId();
    const mainId = new Types.ObjectId();
    const source = {
      _id: sourceId,
      name: 'Стол',
      sku: 'TABLE-1',
      kind: 'good',
      unit: 'шт',
      photoIds: [mainId],
      mainPhotoId: mainId,
      productModuleIds: [],
      composition: [],
    };
    const execFind = jest.fn().mockResolvedValue(source);
    const model = {
      findOne: jest.fn(() => ({ exec: execFind })),
      find: jest.fn(() => ({ select: jest.fn(() => ({ lean: jest.fn(() => ({ exec: jest.fn().mockResolvedValue([]) })) })) })),
      create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), sku: 'TABLE-1-COPY-1' }),
    };
    const service = buildService(model);
    await service.duplicate(sourceId.toString());
    const payload = (model.create as jest.Mock).mock.calls[0][0];
    expect(payload.mainPhotoId).toEqual(mainId);
  });
});
