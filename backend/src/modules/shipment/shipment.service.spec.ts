import { Types } from 'mongoose';
import { ShipmentService } from './shipment.service';

function query<T>(value: T) {
  return {
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

/** countDocuments has no populate/sort — only session+exec. */
function queryCount<T>(value: T) {
  return {
    session: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

/** TZ-SHIP-433: cancelShipment executes its transaction body synchronously. */
function createCancelService() {
  const shipmentModel = {
    find: jest.fn(),
    findOne: jest.fn(),
    countDocuments: jest.fn(),
    updateOne: jest.fn(),
  };
  const orderModel = { findById: jest.fn() };
  const sessionRunner = { run: (fn: (session: unknown) => Promise<unknown>) => fn({}) };
  const service = new ShipmentService(
    shipmentModel as never,
    orderModel as never,
    { next: jest.fn() } as never,
    { create: jest.fn() } as never,
    { findAll: jest.fn(), fulfill: jest.fn() } as never,
    sessionRunner as never,
  );
  return { service, shipmentModel, orderModel };
}

describe('ShipmentService TZ-SUPPLY-312', () => {
  function createService() {
    const model = {
      find: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    const service = new ShipmentService(
      model as never,
      { findById: jest.fn() } as never,
      { next: jest.fn() } as never,
      { create: jest.fn() } as never,
      { findAll: jest.fn(), fulfill: jest.fn() } as never,
      { run: jest.fn() } as never,
    );
    return { service, model };
  }

  it('excludes soft-deleted shipments and applies organization scope to list', async () => {
    const { service, model } = createService();
    model.find.mockReturnValue(query([]));
    const organizationId = new Types.ObjectId().toString();

    await service.findAll(undefined, undefined, undefined, organizationId);

    expect(model.find).toHaveBeenCalledWith({
      deletedAt: null,
      organizationId: new Types.ObjectId(organizationId),
    });
  });

  it('rejects backwards status transitions', async () => {
    const { service } = createService();
    const save = jest.fn();
    jest.spyOn(service, 'findById').mockResolvedValue({ status: 'delivered', save } as never);

    await expect(
      service.update(new Types.ObjectId().toString(), { status: 'in_transit' } as never, null),
    ).rejects.toThrow('Нельзя перевести отгрузку');
    expect(save).not.toHaveBeenCalled();
  });

  it('soft-deletes a shipment within the current organization', async () => {
    const { service, model } = createService();
    const id = new Types.ObjectId();
    const organizationId = new Types.ObjectId().toString();
    jest.spyOn(service, 'findById').mockResolvedValue({ _id: id } as never);

    await service.remove(id.toString(), organizationId);

    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: id, organizationId: new Types.ObjectId(organizationId) },
      { $set: { deletedAt: expect.any(Date), isActive: false } },
    );
  });
});

describe('ShipmentService TZ-SHIP-433 cancelShipment', () => {
  function shippedOrder(orderId: Types.ObjectId) {
    return {
      _id: orderId,
      status: 'shipped',
      items: [
        {
          lineId: 'l1',
          productId: new Types.ObjectId(),
          quantity: 1,
          unitPrice: 1,
          total: 1,
          boardLane: 'shipped',
          status: 'shipped',
        },
      ],
      markModified: jest.fn(),
      save: jest.fn().mockResolvedValue({ status: 'ready' }),
    };
  }

  function scheduledShipment(orderId: Types.ObjectId) {
    return {
      _id: new Types.ObjectId(),
      orderId,
      number: 'SHP-ORD-1',
      status: 'scheduled',
      dispatchedAt: undefined,
      save: jest.fn().mockResolvedValue({ status: 'cancelled' }),
    };
  }

  it('cancels a scheduled whole-order shipment and rolls the order back to ready', async () => {
    const { service, shipmentModel, orderModel } = createCancelService();
    const order = shippedOrder(new Types.ObjectId());
    const shipment = scheduledShipment(order._id);
    shipmentModel.findOne.mockReturnValue(query(shipment));
    shipmentModel.countDocuments.mockReturnValue(queryCount(0));
    orderModel.findById.mockReturnValue(query(order));

    await service.cancelShipment(shipment._id.toString(), null);

    expect(shipment.status).toBe('cancelled');
    expect(shipment.save).toHaveBeenCalled();
    expect(order.status).toBe('ready');
    expect(order.items[0].boardLane).toBe('to_ship');
    expect(order.items[0].status).toBe('ready');
    expect(order.markModified).toHaveBeenCalledWith('items');
    expect(order.save).toHaveBeenCalled();
    expect(shipmentModel.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: order._id,
        _id: { $ne: shipment._id },
        status: { $nin: ['cancelled'] },
      }),
    );
  });

  it('keeps the order shipped when another active shipment exists', async () => {
    const { service, shipmentModel, orderModel } = createCancelService();
    const order = shippedOrder(new Types.ObjectId());
    const shipment = scheduledShipment(order._id);
    shipmentModel.findOne.mockReturnValue(query(shipment));
    shipmentModel.countDocuments.mockReturnValue(queryCount(1));
    orderModel.findById.mockReturnValue(query(order));

    await service.cancelShipment(shipment._id.toString(), null);

    expect(shipment.status).toBe('cancelled');
    expect(order.status).toBe('shipped');
    expect(order.items[0].boardLane).toBe('shipped');
    expect(order.save).not.toHaveBeenCalled();
  });

  it('does not touch the order for a partial (non-shipped) order', async () => {
    const { service, shipmentModel, orderModel } = createCancelService();
    const order = { ...shippedOrder(new Types.ObjectId()), status: 'confirmed' };
    const shipment = scheduledShipment(order._id);
    shipmentModel.findOne.mockReturnValue(query(shipment));
    orderModel.findById.mockReturnValue(query(order));

    await service.cancelShipment(shipment._id.toString(), null);

    expect(shipment.status).toBe('cancelled');
    expect(order.status).toBe('confirmed');
    expect(order.save).not.toHaveBeenCalled();
    expect(shipmentModel.countDocuments).not.toHaveBeenCalled();
  });

  it('rejects a dispatched shipment with a RU 400 (phase 2 limitation)', async () => {
    const { service, shipmentModel } = createCancelService();
    shipmentModel.findOne.mockReturnValue(
      query({
        _id: new Types.ObjectId(),
        orderId: new Types.ObjectId(),
        status: 'in_transit',
        dispatchedAt: new Date(),
        save: jest.fn(),
      }),
    );

    await expect(service.cancelShipment('id', null)).rejects.toThrow(
      'Отгрузка уже отправлена со склада — отмена через склад/админа',
    );
    expect(shipmentModel.countDocuments).not.toHaveBeenCalled();
  });

  it('rejects a shipment already cancelled', async () => {
    const { service, shipmentModel } = createCancelService();
    shipmentModel.findOne.mockReturnValue(
      query({
        _id: new Types.ObjectId(),
        orderId: new Types.ObjectId(),
        status: 'cancelled',
        save: jest.fn(),
      }),
    );

    await expect(service.cancelShipment('id', null)).rejects.toThrow('Отгрузка уже отменена');
  });
});
