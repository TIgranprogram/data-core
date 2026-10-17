import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { KitReserveService } from './kit-reserve.service';

const PRODUCT = new Types.ObjectId();
const MATERIAL_A = new Types.ObjectId();
const MATERIAL_B = new Types.ObjectId();
const MODULE_A = new Types.ObjectId();
const MODULE_B = new Types.ObjectId();
const WAREHOUSE = new Types.ObjectId();

function leanQuery<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function findQuery<T>(value: T) {
  return {
    session: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function orderDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    number: 'ORD-0007',
    deletedAt: null as Date | null,
    organizationId: undefined as Types.ObjectId | undefined,
    items: [{ productId: PRODUCT, quantity: 2 }],
    reservationIds: [] as Types.ObjectId[],
    save: jest.fn().mockImplementation(function (this: unknown) {
      return Promise.resolve(this);
    }),
    ...overrides,
  };
}

function storageRow(overrides: Record<string, unknown> = {}) {
  return { warehouseId: WAREHOUSE, zoneName: undefined, quantity: 0, reservedQty: 0, ...overrides };
}

function createService(overrides: Record<string, unknown> = {}) {
  const orderModel = { findById: jest.fn() };
  const productModel = { findById: jest.fn() };
  const moduleModel = { findById: jest.fn() };
  const materialModel = { findById: jest.fn() };
  const storageModel = { find: jest.fn() };
  const reservationService = { create: jest.fn() };
  const supplyRequests = { create: jest.fn() };
  const sessionRunner = {
    run: jest.fn().mockImplementation(async (fn: (session: unknown) => Promise<unknown>) => fn({})),
  };
  const deps = {
    orderModel,
    productModel,
    moduleModel,
    materialModel,
    storageModel,
    reservationService,
    supplyRequests,
    sessionRunner,
    ...overrides,
  };
  const service = new KitReserveService(
    deps.orderModel as never,
    deps.productModel as never,
    deps.moduleModel as never,
    deps.materialModel as never,
    deps.storageModel as never,
    deps.reservationService as never,
    deps.supplyRequests as never,
    deps.sessionRunner as never,
  );
  return { service, ...deps };
}

describe('KitReserveService (TZ-NX-SUPPLY-S0-KIT-RESERVE-BE)', () => {
  describe('getAvailability', () => {
    it('rejects an unknown order', async () => {
      const { service, orderModel } = createService();
      orderModel.findById.mockReturnValue(findQuery(null));
      await expect(service.getAvailability(new Types.ObjectId().toString(), 0)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects an out-of-bounds order item index', async () => {
      const { service, orderModel } = createService();
      orderModel.findById.mockReturnValue(findQuery(orderDoc()));
      await expect(service.getAvailability(new Types.ObjectId().toString(), 5)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects a cross-org caller', async () => {
      const { service, orderModel } = createService();
      const ownerOrgId = new Types.ObjectId();
      orderModel.findById.mockReturnValue(findQuery(orderDoc({ organizationId: ownerOrgId })));
      await expect(
        service.getAvailability(new Types.ObjectId().toString(), 0, new Types.ObjectId().toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400s when the product has no composition snapshot at all', async () => {
      const { service, orderModel, productModel } = createService();
      orderModel.findById.mockReturnValue(findQuery(orderDoc()));
      productModel.findById.mockReturnValue(leanQuery({ composition: [], productModuleIds: [] }));
      await expect(service.getAvailability(new Types.ObjectId().toString(), 0)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('reports ok when a single module material is fully covered by stock', async () => {
      const { service, orderModel, productModel, moduleModel, materialModel, storageModel } = createService();
      orderModel.findById.mockReturnValue(findQuery(orderDoc({ items: [{ productId: PRODUCT, quantity: 2 }] })));
      productModel.findById.mockReturnValue(leanQuery({ composition: [], productModuleIds: [MODULE_A] }));
      moduleModel.findById.mockReturnValue(
        leanQuery({ composition: [], materials: [{ materialId: MATERIAL_A, quantity: 3 }] }),
      );
      materialModel.findById.mockReturnValue(leanQuery({ name: 'Лист 2мм' }));
      storageModel.find.mockReturnValue(findQuery([storageRow({ quantity: 10, reservedQty: 0 })]));

      const result = await service.getAvailability(new Types.ObjectId().toString(), 0);

      // quantity 2 (order item) × 3 (material per module) = 6 needed.
      expect(result.lines).toEqual([
        {
          materialId: String(MATERIAL_A),
          materialName: 'Лист 2мм',
          needQty: 6,
          availableQty: 10,
          warehouseId: String(WAREHOUSE),
          status: 'ok',
        },
      ]);
      expect(result.summary.canReserveAll).toBe(true);
    });

    it('flags short when stock is below need, and aggregates a nested module (dual-read composition)', async () => {
      const { service, orderModel, productModel, moduleModel, materialModel, storageModel } = createService();
      orderModel.findById.mockReturnValue(findQuery(orderDoc({ items: [{ productId: PRODUCT, quantity: 1 }] })));
      productModel.findById.mockReturnValue(
        leanQuery({ composition: [{ lineType: 'module', refId: MODULE_A, quantity: 1 }], productModuleIds: [] }),
      );
      moduleModel.findById.mockImplementation((id: Types.ObjectId) => {
        if (String(id) === String(MODULE_A)) {
          return leanQuery({
            composition: [
              { lineType: 'material', refId: MATERIAL_B, quantity: 5 },
              { lineType: 'module', refId: MODULE_B, quantity: 2 },
            ],
          });
        }
        return leanQuery({ composition: [], materials: [{ materialId: MATERIAL_B, quantity: 1 }] });
      });
      materialModel.findById.mockReturnValue(leanQuery({ name: 'Уголок' }));
      storageModel.find.mockReturnValue(findQuery([storageRow({ quantity: 4, reservedQty: 0 })]));

      const result = await service.getAvailability(new Types.ObjectId().toString(), 0);

      // module A: 5×1=5 direct + nested module B: 1×2=2 → 7 total need for MATERIAL_B.
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]).toMatchObject({ materialId: String(MATERIAL_B), needQty: 7, availableQty: 4, status: 'short' });
      expect(result.summary.canReserveAll).toBe(false);
    });
  });

  describe('confirmReserve', () => {
    it('reserves an ok material atomically and records the reservation on the order', async () => {
      const { service, orderModel, productModel, moduleModel, storageModel, reservationService } = createService();
      const doc = orderDoc({ items: [{ productId: PRODUCT, quantity: 1 }] });
      orderModel.findById.mockReturnValue(findQuery(doc));
      productModel.findById.mockReturnValue(leanQuery({ composition: [], productModuleIds: [MODULE_A] }));
      moduleModel.findById.mockReturnValue(
        leanQuery({ composition: [], materials: [{ materialId: MATERIAL_A, quantity: 4 }] }),
      );
      storageModel.find.mockReturnValue(findQuery([storageRow({ quantity: 10, reservedQty: 0 })]));
      const reservationId = new Types.ObjectId();
      reservationService.create.mockResolvedValue({ _id: reservationId });

      const result = await service.confirmReserve(doc._id.toString(), 0);

      expect(reservationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: doc.number,
          materialId: String(MATERIAL_A),
          warehouseId: String(WAREHOUSE),
          qty: 4,
          orderItemIndex: 0,
        }),
        expect.anything(),
      );
      expect(result.reserved).toEqual([
        { materialId: String(MATERIAL_A), warehouseId: String(WAREHOUSE), qty: 4, reservationId: String(reservationId) },
      ]);
      expect(result.supplyRequestIds).toEqual([]);
      expect(doc.reservationIds).toEqual([reservationId]);
      expect(doc.save).toHaveBeenCalled();
    });

    it('does not reserve a short line — creates a SupplyRequest for the shortfall instead', async () => {
      const { service, orderModel, productModel, moduleModel, storageModel, reservationService, supplyRequests } =
        createService();
      const doc = orderDoc({ items: [{ productId: PRODUCT, quantity: 1 }] });
      orderModel.findById.mockReturnValue(findQuery(doc));
      productModel.findById.mockReturnValue(leanQuery({ composition: [], productModuleIds: [MODULE_A] }));
      moduleModel.findById.mockReturnValue(
        leanQuery({ composition: [], materials: [{ materialId: MATERIAL_A, quantity: 10 }] }),
      );
      storageModel.find.mockReturnValue(findQuery([storageRow({ quantity: 3, reservedQty: 0 })]));
      const supplyRequestId = new Types.ObjectId();
      supplyRequests.create.mockResolvedValue({ _id: supplyRequestId });

      const result = await service.confirmReserve(doc._id.toString(), 0);

      expect(reservationService.create).not.toHaveBeenCalled();
      expect(supplyRequests.create).toHaveBeenCalledWith(
        expect.objectContaining({ materialId: String(MATERIAL_A), orderId: String(doc._id), qty: 7 }),
        undefined,
        expect.anything(),
      );
      expect(result.reserved).toEqual([]);
      expect(result.supplyRequestIds).toEqual([String(supplyRequestId)]);
      expect(result.warnings).toHaveLength(1);
      expect(doc.reservationIds).toEqual([]);
    });

    it('400s with no composition snapshot and never touches reservations/supply', async () => {
      const { service, orderModel, productModel, reservationService, supplyRequests } = createService();
      const doc = orderDoc();
      orderModel.findById.mockReturnValue(findQuery(doc));
      productModel.findById.mockReturnValue(leanQuery({ composition: [], productModuleIds: [] }));

      await expect(service.confirmReserve(doc._id.toString(), 0)).rejects.toBeInstanceOf(BadRequestException);
      expect(reservationService.create).not.toHaveBeenCalled();
      expect(supplyRequests.create).not.toHaveBeenCalled();
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('propagates a mid-loop failure (SessionRunner owns the abort/rollback)', async () => {
      const { service, orderModel, productModel, moduleModel, storageModel, reservationService } = createService();
      const doc = orderDoc({ items: [{ productId: PRODUCT, quantity: 1 }] });
      orderModel.findById.mockReturnValue(findQuery(doc));
      productModel.findById.mockReturnValue(leanQuery({ composition: [], productModuleIds: [MODULE_A] }));
      moduleModel.findById.mockReturnValue(
        leanQuery({ composition: [], materials: [{ materialId: MATERIAL_A, quantity: 1 }] }),
      );
      storageModel.find.mockReturnValue(findQuery([storageRow({ quantity: 10, reservedQty: 0 })]));
      reservationService.create.mockRejectedValue(new Error('boom'));

      await expect(service.confirmReserve(doc._id.toString(), 0)).rejects.toThrow('boom');
      expect(doc.save).not.toHaveBeenCalled();
    });
  });
});
