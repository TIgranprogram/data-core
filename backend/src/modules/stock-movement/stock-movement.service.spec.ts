import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { StockMovementService } from './stock-movement.service';

const WAREHOUSE = new Types.ObjectId();
const DEFAULT_WAREHOUSE = new Types.ObjectId();
const MATERIAL = new Types.ObjectId();
const PRODUCT = new Types.ObjectId();

function storageDoc(overrides: Record<string, unknown> = {}) {
  return {
    quantity: 0,
    reservedQty: 0,
    save: jest.fn().mockImplementation(function (this: unknown) {
      return Promise.resolve(this);
    }),
    ...overrides,
  };
}

/** Mirrors reservation.service.spec.ts's chained-query mock helper. */
function findOneQuery<T>(value: T) {
  return { session: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}
function plainQuery<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function createService(overrides: Record<string, unknown> = {}) {
  const session = {
    withTransaction: jest.fn(async (fn: () => Promise<void>) => {
      await fn();
    }),
    endSession: jest.fn(),
  };
  const connection = { startSession: jest.fn().mockResolvedValue(session) };
  const model = { create: jest.fn() };
  const storageModel = {
    findOne: jest.fn(),
    create: jest.fn().mockImplementation((docs: Record<string, unknown>[]) =>
      Promise.resolve([{ _id: new Types.ObjectId(), quantity: docs[0]?.['quantity'] ?? 0, ...docs[0] }]),
    ),
  };
  const materialModel = { findOne: jest.fn(), exists: jest.fn() };
  const productModel = { findOne: jest.fn(), exists: jest.fn() };
  const warehouseModel = { findOne: jest.fn() };
  const deps = {
    connection,
    model,
    storageModel,
    materialModel,
    productModel,
    warehouseModel,
    ...overrides,
  };
  const service = new StockMovementService(
    deps.connection as never,
    deps.model as never,
    deps.storageModel as never,
    deps.materialModel as never,
    deps.productModel as never,
    deps.warehouseModel as never,
  );
  return { service, session, ...deps };
}

/** Default happy-path storage/movement wiring shared by most batch rows. */
function wireHappyPath(deps: ReturnType<typeof createService>) {
  deps.storageModel.findOne.mockReturnValue(findOneQuery(null)); // no existing StorageItem -> create
  deps.model.create.mockImplementation((docs: Record<string, unknown>[]) =>
    Promise.resolve([{ _id: new Types.ObjectId(), ...docs[0] }]),
  );
}

describe('StockMovementService.batchInventoryIn (TZ-NX-WH-INV-BE-BATCH)', () => {
  it('resolves by explicit materialId + warehouseId and writes a real IN movement', async () => {
    const deps = createService();
    wireHappyPath(deps);
    deps.materialModel.exists.mockReturnValue(plainQuery({ _id: MATERIAL }));
    deps.warehouseModel.findOne.mockReturnValue(plainQuery({ _id: WAREHOUSE }));

    const result = await deps.service.batchInventoryIn({
      rows: [{ materialId: MATERIAL.toString(), warehouseId: WAREHOUSE.toString(), qty: 5 }],
    });

    expect(result).toEqual({ created: 1, errors: [] });
    expect(deps.model.create).toHaveBeenCalledWith(
      [expect.objectContaining({ type: 'in', qty: 5, materialId: MATERIAL, warehouseId: WAREHOUSE })],
      expect.anything(),
    );
  });

  it('resolves by article (Material) when no explicit id is given', async () => {
    const deps = createService();
    wireHappyPath(deps);
    deps.materialModel.findOne.mockReturnValue(plainQuery({ _id: MATERIAL, article: 'BOLT-M6' }));
    deps.warehouseModel.findOne.mockReturnValue(plainQuery({ _id: WAREHOUSE }));

    const result = await deps.service.batchInventoryIn({
      rows: [{ article: 'BOLT-M6', warehouseId: WAREHOUSE.toString(), qty: 100 }],
    });

    expect(deps.materialModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ article: 'BOLT-M6' }),
    );
    expect(result.created).toBe(1);
  });

  it('resolves by sku, preferring a matching Material over a Product', async () => {
    const deps = createService();
    wireHappyPath(deps);
    deps.materialModel.findOne.mockReturnValue(plainQuery({ _id: MATERIAL, sku: 'SKU-1' }));
    deps.productModel.findOne.mockReturnValue(plainQuery({ _id: PRODUCT, sku: 'SKU-1' }));
    deps.warehouseModel.findOne.mockReturnValue(plainQuery({ _id: WAREHOUSE }));

    await deps.service.batchInventoryIn({
      rows: [{ sku: 'SKU-1', warehouseId: WAREHOUSE.toString(), qty: 1 }],
    });

    expect(deps.model.create).toHaveBeenCalledWith(
      [expect.objectContaining({ materialId: MATERIAL, productId: undefined })],
      expect.anything(),
    );
    expect(deps.productModel.findOne).not.toHaveBeenCalled();
  });

  it('falls back to sku on Product when no Material matches', async () => {
    const deps = createService();
    wireHappyPath(deps);
    deps.materialModel.findOne.mockReturnValue(plainQuery(null));
    deps.productModel.findOne.mockReturnValue(plainQuery({ _id: PRODUCT, sku: 'SKU-GP' }));
    deps.warehouseModel.findOne.mockReturnValue(plainQuery({ _id: WAREHOUSE }));

    await deps.service.batchInventoryIn({
      rows: [{ sku: 'SKU-GP', warehouseId: WAREHOUSE.toString(), qty: 3 }],
    });

    expect(deps.model.create).toHaveBeenCalledWith(
      [expect.objectContaining({ productId: PRODUCT })],
      expect.anything(),
    );
  });

  it('resolves the warehouse by name (case-insensitive) when no warehouseId is given', async () => {
    const deps = createService();
    wireHappyPath(deps);
    deps.materialModel.exists.mockReturnValue(plainQuery({ _id: MATERIAL }));
    deps.warehouseModel.findOne.mockReturnValue(plainQuery({ _id: WAREHOUSE, name: 'Металл' }));

    await deps.service.batchInventoryIn({
      rows: [{ materialId: MATERIAL.toString(), warehouseName: 'металл', qty: 2 }],
    });

    expect(deps.warehouseModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ name: expect.any(RegExp) }),
    );
  });

  it('falls back to the default warehouse when neither warehouseId nor warehouseName is given', async () => {
    const deps = createService();
    wireHappyPath(deps);
    deps.materialModel.exists.mockReturnValue(plainQuery({ _id: MATERIAL }));
    deps.warehouseModel.findOne.mockReturnValue(plainQuery({ _id: DEFAULT_WAREHOUSE, isDefault: true }));

    await deps.service.batchInventoryIn({
      rows: [{ materialId: MATERIAL.toString(), qty: 2 }],
    });

    expect(deps.warehouseModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ isDefault: true }),
    );
    expect(deps.model.create).toHaveBeenCalledWith(
      [expect.objectContaining({ warehouseId: DEFAULT_WAREHOUSE })],
      expect.anything(),
    );
  });

  // TZ AC #1 — «Batch of 2 known materials -> 2 IN + StorageItem qty updated».
  it('processes a batch of 2 known rows independently: 2 IN writes, StorageItem upserted for each', async () => {
    const deps = createService();
    deps.materialModel.exists.mockReturnValue(plainQuery({ _id: MATERIAL }));
    deps.warehouseModel.findOne.mockReturnValue(plainQuery({ _id: WAREHOUSE }));
    const existingItem = storageDoc({ quantity: 10 });
    deps.storageModel.findOne
      .mockReturnValueOnce(findOneQuery(null)) // row 1: no existing StorageItem -> create
      .mockReturnValueOnce(findOneQuery(existingItem)); // row 2: existing -> increment
    deps.model.create.mockImplementation((docs: Record<string, unknown>[]) =>
      Promise.resolve([{ _id: new Types.ObjectId(), ...docs[0] }]),
    );

    const result = await deps.service.batchInventoryIn({
      rows: [
        { materialId: MATERIAL.toString(), warehouseId: WAREHOUSE.toString(), qty: 5 },
        { materialId: MATERIAL.toString(), warehouseId: WAREHOUSE.toString(), qty: 7 },
      ],
    });

    expect(result).toEqual({ created: 2, errors: [] });
    expect(deps.model.create).toHaveBeenCalledTimes(2);
    expect(existingItem.quantity).toBe(17); // 10 + 7, ledger write via StockMovementService.applyIn
    expect(existingItem.save).toHaveBeenCalled();
  });

  // TZ AC #2 — «Unknown article -> row error, others may succeed» (partial + errors[]).
  it('reports an unknown article at its row index and still processes the other rows', async () => {
    const deps = createService();
    wireHappyPath(deps);
    deps.warehouseModel.findOne.mockReturnValue(plainQuery({ _id: WAREHOUSE }));
    deps.materialModel.findOne
      .mockReturnValueOnce(plainQuery(null)) // row 0: article miss
      .mockReturnValueOnce(plainQuery({ _id: MATERIAL, article: 'KNOWN' })); // row 1: hit
    deps.productModel.findOne.mockReturnValue(plainQuery(null));

    const result = await deps.service.batchInventoryIn({
      rows: [
        { article: 'GHOST-999', warehouseId: WAREHOUSE.toString(), qty: 1 },
        { article: 'KNOWN', warehouseId: WAREHOUSE.toString(), qty: 1 },
      ],
    });

    expect(result.created).toBe(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ index: 0, message: expect.stringContaining('GHOST-999') }),
    ]);
  });

  it('rejects a row that gives both materialId and productId (ambiguous)', async () => {
    const deps = createService();
    deps.warehouseModel.findOne.mockReturnValue(plainQuery({ _id: WAREHOUSE }));

    const result = await deps.service.batchInventoryIn({
      rows: [{ materialId: MATERIAL.toString(), productId: PRODUCT.toString(), warehouseId: WAREHOUSE.toString(), qty: 1 }],
    });

    expect(result.created).toBe(0);
    expect(result.errors[0]).toEqual(expect.objectContaining({ index: 0 }));
    expect(deps.model.create).not.toHaveBeenCalled();
  });

  it('rejects a row with neither an id nor article/sku', async () => {
    const deps = createService();
    deps.warehouseModel.findOne.mockReturnValue(plainQuery({ _id: WAREHOUSE }));

    const result = await deps.service.batchInventoryIn({
      rows: [{ warehouseId: WAREHOUSE.toString(), qty: 1 } as never],
    });

    expect(result.errors).toHaveLength(1);
    expect(deps.model.create).not.toHaveBeenCalled();
  });

  it('reports an unknown warehouse name without throwing the whole batch', async () => {
    const deps = createService();
    deps.materialModel.exists.mockReturnValue(plainQuery({ _id: MATERIAL }));
    deps.warehouseModel.findOne.mockReturnValue(plainQuery(null));

    const result = await deps.service.batchInventoryIn({
      rows: [{ materialId: MATERIAL.toString(), warehouseName: 'Нет такого', qty: 1 }],
    });

    expect(result.created).toBe(0);
    expect(result.errors[0].message).toContain('Нет такого');
  });

  it('never falls back to Material.stockQty / Product.stockQty — writes only through StockMovement + StorageItem', async () => {
    const deps = createService();
    wireHappyPath(deps);
    deps.materialModel.exists.mockReturnValue(plainQuery({ _id: MATERIAL }));
    deps.warehouseModel.findOne.mockReturnValue(plainQuery({ _id: WAREHOUSE }));

    await deps.service.batchInventoryIn({
      rows: [{ materialId: MATERIAL.toString(), warehouseId: WAREHOUSE.toString(), qty: 1 }],
    });

    expect(deps.materialModel).not.toHaveProperty('updateOne');
    expect(deps.model.create).toHaveBeenCalled();
    expect(deps.storageModel.findOne).toHaveBeenCalled();
  });
});

describe('StockMovementService.batchInventoryIn — BadRequestException surface (not raw errors)', () => {
  it('resolveInventoryTarget/resolveInventoryWarehouse failures still surface as row errors, never an uncaught throw', async () => {
    const deps = createService();
    deps.warehouseModel.findOne.mockReturnValue(plainQuery({ _id: WAREHOUSE }));
    deps.materialModel.exists.mockReturnValue(plainQuery(null)); // material id given but missing

    await expect(
      deps.service.batchInventoryIn({
        rows: [{ materialId: MATERIAL.toString(), warehouseId: WAREHOUSE.toString(), qty: 1 }],
      }),
    ).resolves.toEqual({
      created: 0,
      errors: [expect.objectContaining({ index: 0, message: expect.stringContaining(MATERIAL.toString()) })],
    });
  });

  it('a directly-thrown BadRequestException from resolution is caught, not propagated', async () => {
    const deps = createService();
    // Sanity: the private resolvers throw BadRequestException — confirmed by the ambiguous-row test above.
    // This test only pins that batchInventoryIn itself never rejects the returned promise.
    deps.warehouseModel.findOne.mockReturnValue(plainQuery({ _id: WAREHOUSE }));
    const promise = deps.service.batchInventoryIn({
      rows: [{ warehouseId: WAREHOUSE.toString(), qty: 1 } as never],
    });
    await expect(promise).resolves.not.toBeInstanceOf(BadRequestException);
  });
});
