import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SupplyRequestService } from './supply-request.service';

function mockQuery<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function createService() {
  const model = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    db: {
      collection: jest.fn(),
    },
  };
  const supplyTasks = {
    create: jest.fn(),
    findOpenByOrderMaterial: jest.fn(),
  };
  const warehouses = {
    findDefault: jest.fn(),
  };
  const stockMovements = {
    create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
  };
  const service = new SupplyRequestService(
    model as never,
    supplyTasks as never,
    warehouses as never,
    stockMovements as never,
  );
  return { service, model, supplyTasks, warehouses, stockMovements };
}

const savedDoc = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  status: 'in_progress',
  priority: 'normal',
  qty: 1,
  save: jest.fn().mockImplementation(function (this: Record<string, unknown>) {
    return Promise.resolve(this);
  }),
  ...overrides,
});

describe('SupplyRequestService (TZ-SUPPLY-305)', () => {
  it('create stores a request with defaults and material snapshot', async () => {
    const { service, model } = createService();
    const materialId = new Types.ObjectId();
    model.db.collection.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({ name: 'Подшипник', article: '6205', unit: 'шт' }),
    });
    model.create.mockResolvedValue([savedDoc()]);

    await service.create({ materialId: materialId.toString(), qty: 4 });

    expect(model.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          materialId,
          title: 'Подшипник',
          article: '6205',
          unit: 'шт',
          qty: 4,
          status: 'in_progress',
          priority: 'normal',
        }),
      ],
      { session: undefined },
    );
  });

  it('create allows an empty draft for the quick-order form', async () => {
    const { service, model } = createService();
    model.create.mockResolvedValue([savedDoc({ qty: 1 })]);

    await service.create({ qty: 1 });

    expect(model.create).toHaveBeenCalledWith(
      [expect.objectContaining({ qty: 1, status: 'in_progress', priority: 'normal' })],
      { session: undefined },
    );
  });

  it('update refreshes snapshot when material changes', async () => {
    const { service, model } = createService();
    const id = new Types.ObjectId();
    const newMaterialId = new Types.ObjectId();
    model.findOne.mockReturnValue(
      mockQuery(savedDoc({ _id: id, materialId: new Types.ObjectId() })),
    );
    model.db.collection.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        name: 'Фреза D6',
        article: 'FR-D6',
        unit: 'шт',
      }),
    });

    await service.update(id.toString(), { materialId: newMaterialId.toString() });

    const doc = await model.findOne().exec();
    expect(doc.materialId).toEqual(newMaterialId);
    expect(doc.title).toBe('Фреза D6');
    expect(doc.article).toBe('FR-D6');
    expect(doc.unit).toBe('шт');
  });

  it('markOrdered without order/material only sets status (no spawn)', async () => {
    const { service, model, supplyTasks } = createService();
    const id = new Types.ObjectId();
    model.findOne.mockReturnValue(mockQuery(savedDoc({ _id: id })));

    const res = await service.markOrdered(id.toString());

    expect(res.status).toBe('ordered');
    expect(res.linkedSupplyTaskId).toBeUndefined();
    expect(supplyTasks.create).not.toHaveBeenCalled();
  });

  it('markOrdered is idempotent when a registry task is already linked', async () => {
    const { service, model, supplyTasks } = createService();
    const id = new Types.ObjectId();
    const linkedTaskId = new Types.ObjectId();
    model.findOne.mockReturnValue(
      mockQuery(
        savedDoc({
          _id: id,
          orderId: new Types.ObjectId(),
          materialId: new Types.ObjectId(),
          linkedSupplyTaskId: linkedTaskId,
        }),
      ),
    );

    const res = await service.markOrdered(id.toString());

    expect(res.status).toBe('ordered');
    expect(res.linkedSupplyTaskId).toEqual(linkedTaskId);
    expect(supplyTasks.create).not.toHaveBeenCalled();
  });

  it('markOrdered reuses an existing open registry task when the link is missing', async () => {
    const { service, model, supplyTasks } = createService();
    const id = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    const materialId = new Types.ObjectId();
    const taskId = new Types.ObjectId();
    model.findOne.mockReturnValue(
      mockQuery(savedDoc({ _id: id, orderId, materialId, qty: 7, title: 'Труба' })),
    );
    supplyTasks.findOpenByOrderMaterial.mockResolvedValue({ _id: taskId });

    const res = await service.markOrdered(id.toString(), '6a87612801719b34e2728ac1');

    expect(supplyTasks.findOpenByOrderMaterial).toHaveBeenCalledWith(
      orderId.toString(),
      materialId.toString(),
      '6a87612801719b34e2728ac1',
    );
    expect(supplyTasks.create).not.toHaveBeenCalled();
    expect(res.linkedSupplyTaskId).toEqual(taskId);
  });

  it('markOrdered with order+material spawns a SupplyTask and links it', async () => {
    const { service, model, supplyTasks } = createService();
    const id = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    const materialId = new Types.ObjectId();
    const taskId = new Types.ObjectId();
    model.findOne.mockReturnValue(
      mockQuery(savedDoc({ _id: id, orderId, materialId, qty: 7, title: 'Труба' })),
    );
    supplyTasks.create.mockResolvedValue({ _id: taskId });

    const res = await service.markOrdered(id.toString());

    expect(supplyTasks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: orderId.toString(),
        materialId: materialId.toString(),
        qty: 7,
        title: 'Труба',
      }),
      undefined,
      'ordered',
    );
    expect(res.linkedSupplyTaskId).toEqual(taskId);
    expect(res.status).toBe('ordered');
  });

  it('create sets createdBy from the request user and defaults paid=false', async () => {
    const { service, model } = createService();
    model.create.mockResolvedValue([savedDoc()]);
    const userId = new Types.ObjectId();

    await service.create({ qty: 1 }, null, undefined, userId.toString());

    expect(model.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          createdBy: userId,
          paid: false,
          paidAt: undefined,
        }),
      ],
      { session: undefined },
    );
  });

  it('create leaves createdBy unset without an authenticated user (system-spawned request)', async () => {
    const { service, model } = createService();
    model.create.mockResolvedValue([savedDoc()]);

    await service.create({ qty: 1 });

    expect(model.create).toHaveBeenCalledWith(
      [expect.objectContaining({ createdBy: undefined })],
      { session: undefined },
    );
  });

  it('create prefers orderId over orderLabel (XOR)', async () => {
    const { service, model } = createService();
    model.create.mockResolvedValue([savedDoc()]);
    const orderId = new Types.ObjectId();

    await service.create({ qty: 1, orderId: orderId.toString(), orderLabel: 'Цех 2' });

    expect(model.create).toHaveBeenCalledWith(
      [expect.objectContaining({ orderId, orderLabel: undefined })],
      { session: undefined },
    );
  });

  it('create keeps orderLabel when there is no orderId', async () => {
    const { service, model } = createService();
    model.create.mockResolvedValue([savedDoc()]);

    await service.create({ qty: 1, orderLabel: 'Цех 2' });

    expect(model.create).toHaveBeenCalledWith(
      [expect.objectContaining({ orderId: undefined, orderLabel: 'Цех 2' })],
      { session: undefined },
    );
  });

  it('create stores invoiceNo/deliveryNote and honors an initial paid=true', async () => {
    const { service, model } = createService();
    model.create.mockResolvedValue([savedDoc()]);

    await service.create({ qty: 1, invoiceNo: 'INV-1', deliveryNote: 'ТК Деловые линии', paid: true });

    expect(model.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          invoiceNo: 'INV-1',
          deliveryNote: 'ТК Деловые линии',
          paid: true,
          paidAt: expect.any(Date),
        }),
      ],
      { session: undefined },
    );
  });

  it('update toggles paid independently of status and stamps/clears paidAt', async () => {
    const { service, model } = createService();
    const id = new Types.ObjectId();
    model.findOne.mockReturnValue(mockQuery(savedDoc({ _id: id, paid: false })));

    const paidDoc = await service.update(id.toString(), { paid: true });
    expect(paidDoc.paid).toBe(true);
    expect(paidDoc.paidAt).toBeInstanceOf(Date);

    model.findOne.mockReturnValue(
      mockQuery(savedDoc({ _id: id, paid: true, paidAt: new Date() })),
    );
    const unpaidDoc = await service.update(id.toString(), { paid: false });
    expect(unpaidDoc.paid).toBe(false);
    expect(unpaidDoc.paidAt).toBeUndefined();

    // status stays independent — no status field touched by the paid toggle.
    expect(paidDoc.status).toBe('in_progress');
  });

  it('update clears orderLabel once a matching Order is set, and vice versa is XOR', async () => {
    const { service, model } = createService();
    const id = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    model.findOne.mockReturnValue(
      mockQuery(savedDoc({ _id: id, orderLabel: 'Цех 2' })),
    );

    const doc = await service.update(id.toString(), { orderId: orderId.toString() });
    expect(doc.orderId).toEqual(orderId);
    expect(doc.orderLabel).toBeUndefined();
  });

  it('update ignores orderLabel while an orderId is already set', async () => {
    const { service, model } = createService();
    const id = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    model.findOne.mockReturnValue(mockQuery(savedDoc({ _id: id, orderId })));

    const doc = await service.update(id.toString(), { orderLabel: 'Цех 2' });
    expect(doc.orderLabel).toBeUndefined();
  });

  it('receive posts a StockMovement IN with the default warehouse and marks the request received', async () => {
    const { service, model, warehouses, stockMovements } = createService();
    const id = new Types.ObjectId();
    const materialId = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    const defaultWarehouseId = new Types.ObjectId();
    model.findOne.mockReturnValue(
      mockQuery(savedDoc({ _id: id, materialId, orderId, status: 'ordered' })),
    );
    warehouses.findDefault.mockResolvedValue({ _id: defaultWarehouseId });

    const res = await service.receive(id.toString(), { receivedQty: 8 });

    expect(stockMovements.create).toHaveBeenCalledWith({
      type: 'in',
      materialId: materialId.toString(),
      warehouseId: defaultWarehouseId.toString(),
      qty: 8,
      orderId: orderId.toString(),
      documentRef: `SupplyRequest:${id.toString()}`,
    });
    expect(res.status).toBe('received');
    expect(res.receivedQty).toBe(8);
  });

  it('receive uses an explicit warehouseId over the default', async () => {
    const { service, model, warehouses, stockMovements } = createService();
    const id = new Types.ObjectId();
    const materialId = new Types.ObjectId();
    const explicitWarehouseId = new Types.ObjectId();
    model.findOne.mockReturnValue(mockQuery(savedDoc({ _id: id, materialId, status: 'in_progress' })));

    await service.receive(id.toString(), { warehouseId: explicitWarehouseId.toString(), receivedQty: 3 });

    expect(warehouses.findDefault).not.toHaveBeenCalled();
    expect(stockMovements.create).toHaveBeenCalledWith(
      expect.objectContaining({ warehouseId: explicitWarehouseId.toString() }),
    );
  });

  it('receive rejects a repeat receive with 409, no reverse path', async () => {
    const { service, model, stockMovements } = createService();
    const id = new Types.ObjectId();
    model.findOne.mockReturnValue(
      mockQuery(savedDoc({ _id: id, materialId: new Types.ObjectId(), status: 'received' })),
    );

    await expect(service.receive(id.toString(), { receivedQty: 5 })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(stockMovements.create).not.toHaveBeenCalled();
  });

  it('receive rejects a request with no linked material', async () => {
    const { service, model, stockMovements } = createService();
    const id = new Types.ObjectId();
    model.findOne.mockReturnValue(mockQuery(savedDoc({ _id: id, status: 'in_progress' })));

    await expect(service.receive(id.toString(), { receivedQty: 5 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(stockMovements.create).not.toHaveBeenCalled();
  });

  it('receive rejects when no warehouseId is given and there is no default warehouse', async () => {
    const { service, model, warehouses, stockMovements } = createService();
    const id = new Types.ObjectId();
    model.findOne.mockReturnValue(
      mockQuery(savedDoc({ _id: id, materialId: new Types.ObjectId(), status: 'in_progress' })),
    );
    warehouses.findDefault.mockResolvedValue(null);

    await expect(service.receive(id.toString(), { receivedQty: 5 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(stockMovements.create).not.toHaveBeenCalled();
  });

  it('remove soft-deletes', async () => {
    const { service, model } = createService();
    const id = new Types.ObjectId();
    model.findOne.mockReturnValue(mockQuery(savedDoc({ _id: id })));

    await service.remove(id.toString());

    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: id },
      { $set: { deletedAt: expect.any(Date) } },
    );
  });

  it('findById 404 for unknown id', async () => {
    const { service, model } = createService();
    model.findOne.mockReturnValue(mockQuery(null));
    await expect(
      service.findById(new Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
