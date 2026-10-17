import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ReservationService } from './reservation.service';

const WAREHOUSE = new Types.ObjectId();
const PRODUCT = new Types.ObjectId();
const MATERIAL = new Types.ObjectId();

function storageDoc(overrides: Record<string, unknown> = {}) {
  return {
    quantity: 10,
    reservedQty: 0,
    save: jest.fn().mockImplementation(function (this: unknown) {
      return Promise.resolve(this);
    }),
    ...overrides,
  };
}

function findOneQuery<T>(value: T) {
  return { session: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}

function createService(overrides: Record<string, unknown> = {}) {
  const connection = { startSession: jest.fn() };
  const model = { create: jest.fn(), find: jest.fn(), findById: jest.fn() };
  const storageModel = { findOne: jest.fn() };
  const movementModel = { create: jest.fn() };
  const deps = { connection, model, storageModel, movementModel, ...overrides };
  const service = new ReservationService(
    deps.connection as never,
    deps.model as never,
    deps.storageModel as never,
    deps.movementModel as never,
  );
  return { service, ...deps };
}

const SESSION = {} as never;

describe('ReservationService (TZ-NX-SUPPLY-S0: materialId alongside productId)', () => {
  describe('create (externalSession path — used by kit-reserve + order.reserveStock)', () => {
    it('rejects when both productId and materialId are given', async () => {
      const { service } = createService();
      await expect(
        service.create(
          { orderId: 'ORD-1', productId: PRODUCT.toString(), materialId: MATERIAL.toString(), warehouseId: WAREHOUSE.toString(), qty: 1 },
          SESSION,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when neither productId nor materialId is given', async () => {
      const { service } = createService();
      await expect(
        service.create({ orderId: 'ORD-1', warehouseId: WAREHOUSE.toString(), qty: 1 } as never, SESSION),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reserves against a material storage item and stamps orderItemIndex', async () => {
      const { service, storageModel, model } = createService();
      const item = storageDoc({ quantity: 10, reservedQty: 2 });
      storageModel.findOne.mockReturnValue(findOneQuery(item));
      const created = { _id: new Types.ObjectId() };
      model.create.mockResolvedValue([created]);

      const result = await service.create(
        { orderId: 'ORD-1', materialId: MATERIAL.toString(), warehouseId: WAREHOUSE.toString(), qty: 4, orderItemIndex: 2 },
        SESSION,
      );

      expect(storageModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ materialId: MATERIAL, warehouseId: WAREHOUSE }),
      );
      expect(item.reservedQty).toBe(6);
      expect(item.save).toHaveBeenCalledWith({ session: SESSION });
      expect(model.create).toHaveBeenCalledWith(
        [expect.objectContaining({ materialId: MATERIAL, orderItemIndex: 2, status: 'active' })],
        { session: SESSION },
      );
      expect(result).toBe(created);
    });

    it('still reserves against a product storage item (regression — legacy finished-good reserve)', async () => {
      const { service, storageModel, model } = createService();
      storageModel.findOne.mockReturnValue(findOneQuery(storageDoc({ quantity: 5, reservedQty: 0 })));
      model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await service.create(
        { orderId: 'ORD-1', productId: PRODUCT.toString(), warehouseId: WAREHOUSE.toString(), qty: 2 },
        SESSION,
      );

      expect(storageModel.findOne).toHaveBeenCalledWith(expect.objectContaining({ productId: PRODUCT }));
      expect(model.create).toHaveBeenCalledWith(
        [expect.objectContaining({ productId: PRODUCT })],
        { session: SESSION },
      );
    });

    it('rejects when requested qty exceeds available stock', async () => {
      const { service, storageModel } = createService();
      storageModel.findOne.mockReturnValue(findOneQuery(storageDoc({ quantity: 3, reservedQty: 2 })));
      await expect(
        service.create({ orderId: 'ORD-1', materialId: MATERIAL.toString(), warehouseId: WAREHOUSE.toString(), qty: 5 }, SESSION),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s when no storage item exists for the material in that warehouse', async () => {
      const { service, storageModel } = createService();
      storageModel.findOne.mockReturnValue(findOneQuery(null));
      await expect(
        service.create({ orderId: 'ORD-1', materialId: MATERIAL.toString(), warehouseId: WAREHOUSE.toString(), qty: 1 }, SESSION),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('release', () => {
    it('releases a material-based reservation against the matching material storage item', async () => {
      const { service, model, storageModel, connection } = createService();
      const reservationId = new Types.ObjectId();
      const reservationDoc = {
        _id: reservationId,
        status: 'active',
        materialId: MATERIAL,
        productId: undefined,
        warehouseId: WAREHOUSE,
        zoneName: undefined,
        qty: 3,
        save: jest.fn().mockImplementation(function (this: unknown) {
          return Promise.resolve(this);
        }),
      };
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(reservationDoc) });
      const item = storageDoc({ quantity: 10, reservedQty: 3 });
      storageModel.findOne.mockReturnValue(findOneQuery(item));
      connection.startSession.mockResolvedValue({
        withTransaction: async (fn: () => Promise<void>) => fn(),
        endSession: jest.fn(),
      });

      const result = await service.release(reservationId.toString());

      expect(storageModel.findOne).toHaveBeenCalledWith(expect.objectContaining({ materialId: MATERIAL }));
      expect(item.reservedQty).toBe(0);
      expect(result.status).toBe('released');
    });
  });

  describe('fulfill (externalSession — Z-001)', () => {
    it('writes an OUT movement keyed by materialId, not productId', async () => {
      const { service, model, storageModel, movementModel } = createService();
      const reservationId = new Types.ObjectId();
      const reservationDoc = {
        _id: reservationId,
        status: 'active',
        materialId: MATERIAL,
        productId: undefined,
        warehouseId: WAREHOUSE,
        zoneName: undefined,
        qty: 2,
        orderId: 'ORD-1',
        save: jest.fn().mockImplementation(function (this: unknown) {
          return Promise.resolve(this);
        }),
      };
      model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(reservationDoc) });
      storageModel.findOne.mockReturnValue(findOneQuery(storageDoc({ quantity: 10, reservedQty: 2 })));
      movementModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      const result = await service.fulfill(reservationId.toString(), SESSION);

      expect(movementModel.create).toHaveBeenCalledWith(
        [expect.objectContaining({ type: 'out', materialId: MATERIAL })],
        { session: SESSION },
      );
      const [[movementRows]] = movementModel.create.mock.calls;
      expect(movementRows[0]).not.toHaveProperty('productId');
      expect(result.status).toBe('fulfilled');
    });
  });
});
