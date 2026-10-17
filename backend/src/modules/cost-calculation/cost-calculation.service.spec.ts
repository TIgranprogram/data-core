import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CostCalculationService } from './cost-calculation.service';

function leanExec<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('CostCalculationService (TZ-COST-302)', () => {
  const materialId = new Types.ObjectId();
  const workTypeId = new Types.ObjectId();
  const childModuleId = new Types.ObjectId();
  const parentModuleId = new Types.ObjectId();
  const productId = new Types.ObjectId();
  const calcId = new Types.ObjectId();

  function build(overrides: {
    product?: unknown;
    productsById?: Record<string, unknown>;
    modulesById?: Record<string, unknown>;
    materialsById?: Record<string, unknown>;
    workTypesById?: Record<string, unknown>;
    calcDoc?: Record<string, unknown>;
  } = {}) {
    const modulesById = overrides.modulesById ?? {};
    const productsById = overrides.productsById ?? {};
    const materialsById = overrides.materialsById ?? {
      [String(materialId)]: { _id: materialId, name: 'Лист', pricePerUnit: 100 },
    };
    const workTypesById = overrides.workTypesById ?? {
      [String(workTypeId)]: { _id: workTypeId, name: 'Сварка', hourlyRate: 500 },
    };

    const model = {
      create: jest.fn().mockImplementation(async (doc: Record<string, unknown>) => ({
        ...doc,
        _id: calcId,
        save: jest.fn().mockImplementation(async function (this: Record<string, unknown>) {
          return this;
        }),
      })),
      findById: jest.fn(),
      findOne: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      }),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      find: jest.fn(),
    };
    const productModel = {
      findById: jest.fn().mockImplementation((id: Types.ObjectId) => {
        const key = String(id);
        if (Object.prototype.hasOwnProperty.call(productsById, key)) {
          return leanExec(productsById[key]);
        }
        return leanExec(
          overrides.product ?? {
            composition: [
              { lineType: 'module', refId: parentModuleId, quantity: 1 },
            ],
          },
        );
      }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    const productModuleModel = {
      findById: jest.fn().mockImplementation((id: Types.ObjectId) =>
        leanExec(modulesById[String(id)] ?? null),
      ),
    };
    const materialModel = {
      findById: jest.fn().mockImplementation((id: Types.ObjectId) =>
        leanExec(materialsById[String(id)] ?? null),
      ),
    };
    const workTypeModel = {
      findById: jest.fn().mockImplementation((id: Types.ObjectId) =>
        leanExec(workTypesById[String(id)] ?? null),
      ),
    };

    const service = new CostCalculationService(
      model as any,
      productModel as any,
      productModuleModel as any,
      materialModel as any,
      workTypeModel as any,
    );

    if (overrides.calcDoc) {
      const doc = {
        ...overrides.calcDoc,
        save: jest.fn().mockImplementation(async function (this: typeof overrides.calcDoc) {
          return this;
        }),
      };
      model.findById.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(doc),
      });
    }

    return { service, model, productModel, productModuleModel };
  }

  it('overheadFromMaterials is canon A (materials only)', () => {
    expect(CostCalculationService.overheadFromMaterials(1000, 10)).toBe(100);
  });

  it('rolls up nested module × qty into materials and labor', async () => {
    const { service, model } = build({
      modulesById: {
        [String(parentModuleId)]: {
          _id: parentModuleId,
          composition: [
            { lineType: 'module', refId: childModuleId, quantity: 2 },
          ],
          workTypes: [],
          materials: [],
        },
        [String(childModuleId)]: {
          _id: childModuleId,
          composition: [
            { lineType: 'material', refId: materialId, quantity: 3, unit: 'шт' },
          ],
          workTypes: [{ workTypeId, estimatedHours: 1 }],
          materials: [],
        },
      },
    });

    const result = await service.create({ productId: String(productId), overheadPercent: 10 });

    // child materials 3 × parent qty 2 = 6 → 600; labor 1h × 2 = 2h → 1000; overhead 10% of 600 = 60
    expect(result.totalMaterialCost).toBe(600);
    expect(result.totalLaborCost).toBe(1000);
    expect(result.overheadCost).toBe(60);
    expect(result.totalCost).toBe(1660);
    expect(model.create).toHaveBeenCalledTimes(1);
  });

  it('skips cycles with infos warn (no throw)', async () => {
    const { service } = build({
      modulesById: {
        [String(parentModuleId)]: {
          _id: parentModuleId,
          composition: [
            { lineType: 'module', refId: childModuleId, quantity: 1 },
            { lineType: 'material', refId: materialId, quantity: 1 },
          ],
          workTypes: [],
          materials: [],
        },
        [String(childModuleId)]: {
          _id: childModuleId,
          composition: [
            { lineType: 'module', refId: parentModuleId, quantity: 1 },
          ],
          workTypes: [],
          materials: [],
        },
      },
    });

    const result = await service.create({ productId: String(productId) });
    expect(result.infos?.some((i: string) => i.includes('cycle'))).toBe(true);
    expect(result.totalMaterialCost).toBe(100);
  });

  it('activate syncs Product.costPrice = totalCost and clears other actives by ObjectId', async () => {
    const { service, productModel, model } = build({
      calcDoc: {
        _id: calcId,
        productId, // raw ObjectId (also covers populated via resolveProductId)
        totalCost: 4242,
        isActive: false,
      },
    });

    const saved = await service.activate(String(calcId));
    expect(saved.isActive).toBe(true);
    expect(model.updateMany).toHaveBeenCalledWith(
      { productId, _id: { $ne: calcId }, isActive: true },
      { $set: { isActive: false } },
    );
    expect(productModel.updateOne).toHaveBeenCalledWith(
      { _id: productId },
      { $set: { costPrice: 4242 } },
    );
  });

  it('activate resolves populated productId to ObjectId', async () => {
    const { service, model, productModel } = build({
      calcDoc: {
        _id: calcId,
        productId: { _id: productId, name: 'Изделие' },
        totalCost: 100,
        isActive: false,
      },
    });
    await service.activate(String(calcId));
    expect(model.updateMany).toHaveBeenCalledWith(
      { productId, _id: { $ne: calcId }, isActive: true },
      { $set: { isActive: false } },
    );
    expect(productModel.updateOne).toHaveBeenCalledWith(
      { _id: productId },
      { $set: { costPrice: 100 } },
    );
  });

  it('previewModuleCost walks nested × qty without creating a journal doc', async () => {
    const { service, model } = build({
      modulesById: {
        [String(parentModuleId)]: {
          _id: parentModuleId,
          composition: [
            { lineType: 'module', refId: childModuleId, quantity: 2 },
          ],
          workTypes: [],
          materials: [],
        },
        [String(childModuleId)]: {
          _id: childModuleId,
          composition: [
            { lineType: 'material', refId: materialId, quantity: 3 },
          ],
          workTypes: [{ workTypeId, estimatedHours: 1 }],
          materials: [],
        },
      },
    });

    const preview = await service.previewModuleCost(String(parentModuleId));
    expect(preview).toEqual({
      materialCost: 600,
      laborCost: 1000,
      totalCost: 1600,
      currency: 'RUB',
    });
    expect(model.create).not.toHaveBeenCalled();
  });

  it('previewModuleCost 404 for unknown module', async () => {
    const { service } = build({ modulesById: {} });
    await expect(
      service.previewModuleCost(String(parentModuleId)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('TZ-COST-305 product-line contribution', () => {
    const childProductId = new Types.ObjectId();

    it('includes unitPriceOverride × qty in totalCost (not in overhead base)', async () => {
      const { service } = build({
        product: {
          composition: [
            {
              lineType: 'product',
              refId: childProductId,
              quantity: 2,
              unitPriceOverride: 1500,
            },
          ],
        },
        productsById: {
          [String(childProductId)]: {
            _id: childProductId,
            name: 'Дочернее',
            costPrice: 999,
          },
        },
      });

      const result = await service.create({
        productId: String(productId),
        overheadPercent: 10,
      });

      expect(result.totalMaterialCost).toBe(0);
      expect(result.overheadCost).toBe(0);
      expect(result.totalProductLineCost).toBe(3000);
      expect(result.productLines).toEqual([
        expect.objectContaining({
          quantity: 2,
          unitCost: 1500,
          total: 3000,
          source: 'override',
        }),
      ]);
      expect(result.totalCost).toBe(3000);
    });

    it('falls back to child.costPrice × qty when override empty', async () => {
      const { service } = build({
        product: {
          composition: [
            { lineType: 'product', refId: childProductId, quantity: 3 },
          ],
        },
        productsById: {
          [String(childProductId)]: {
            _id: childProductId,
            name: 'Дочернее',
            costPrice: 400,
          },
        },
      });

      const result = await service.create({
        productId: String(productId),
        overheadPercent: 10,
      });

      expect(result.totalProductLineCost).toBe(1200);
      expect(result.productLines?.[0]).toEqual(
        expect.objectContaining({ source: 'costPrice', unitCost: 400, total: 1200 }),
      );
      expect(result.totalCost).toBe(1200);
      expect(result.overheadCost).toBe(0);
    });

    it('contrib 0 + infos when override and child.costPrice both empty', async () => {
      const { service } = build({
        product: {
          composition: [
            { lineType: 'product', refId: childProductId, quantity: 1 },
          ],
        },
        productsById: {
          [String(childProductId)]: {
            _id: childProductId,
            name: 'Пустое',
            costPrice: null,
          },
        },
      });

      const result = await service.create({ productId: String(productId) });

      expect(result.totalProductLineCost).toBe(0);
      expect(result.productLines?.[0]?.source).toBe('none');
      expect(result.infos?.some((i: string) => i.includes('вклад 0'))).toBe(true);
      expect(result.totalCost).toBe(0);
    });

    it('regression: material+module rollup unchanged when no product-lines', async () => {
      const { service } = build({
        modulesById: {
          [String(parentModuleId)]: {
            _id: parentModuleId,
            composition: [
              { lineType: 'material', refId: materialId, quantity: 2, unit: 'шт' },
            ],
            workTypes: [{ workTypeId, estimatedHours: 1 }],
            materials: [],
          },
        },
        product: {
          composition: [
            { lineType: 'module', refId: parentModuleId, quantity: 1 },
            { lineType: 'material', refId: materialId, quantity: 1 },
          ],
        },
      });

      const result = await service.create({
        productId: String(productId),
        overheadPercent: 10,
      });

      // materials: module 2×100 + root 1×100 = 300; labor 500; overhead 30
      expect(result.totalMaterialCost).toBe(300);
      expect(result.totalLaborCost).toBe(500);
      expect(result.overheadCost).toBe(30);
      expect(result.totalProductLineCost).toBe(0);
      expect(result.productLines).toEqual([]);
      expect(result.totalCost).toBe(830);
    });
  });
});
