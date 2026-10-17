import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SupplyTaskService } from './supply-task.service';

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
  const service = new SupplyTaskService(model as never);
  return { service, model };
}

describe('SupplyTaskService (TZ-SUPPLY-301)', () => {
  const ORDER = new Types.ObjectId().toString();
  const USER = new Types.ObjectId().toString();

  it('create stores draft task with order + qty', async () => {
    const { service, model } = createService();
    const doc = { _id: new Types.ObjectId(), status: 'draft' };
    model.create.mockResolvedValue(doc);
    const res = await service.create({
      orderId: ORDER,
      qty: 3,
      title: 'Труба 40×40',
    });
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        qty: 3,
        title: 'Труба 40×40',
        status: 'draft',
      }),
    );
    expect(res).toBe(doc);
  });

  it('create rejects without material/module/title', async () => {
    const { service } = createService();
    await expect(
      service.create({ orderId: ORDER, qty: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confirm sets confirmedBy + confirmedAt and status', async () => {
    const { service, model } = createService();
    const id = new Types.ObjectId().toString();
    const doc = {
      _id: id,
      status: 'draft' as const,
      save: jest.fn().mockImplementation(function (this: {
        status: string;
        confirmedBy?: Types.ObjectId;
        confirmedAt?: Date;
      }) {
        return Promise.resolve(this);
      }),
    };
    model.findOne.mockReturnValue(mockQuery(doc));
    const res = await service.confirm(id, USER);
    expect(res.status).toBe('confirmed');
    expect(res.confirmedBy?.toString()).toBe(USER);
    expect(res.confirmedAt).toBeInstanceOf(Date);
  });

  it('confirm rejects when not draft', async () => {
    const { service, model } = createService();
    const id = new Types.ObjectId().toString();
    model.findOne.mockReturnValue(
      mockQuery({
        _id: id,
        status: 'ordered',
        save: jest.fn(),
      }),
    );
    await expect(service.confirm(id, USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('markOrdered requires confirmed', async () => {
    const { service, model } = createService();
    const id = new Types.ObjectId().toString();
    const doc = {
      _id: id,
      status: 'confirmed' as const,
      save: jest.fn().mockImplementation(function (this: { status: string }) {
        return Promise.resolve(this);
      }),
    };
    model.findOne.mockReturnValue(mockQuery(doc));
    const res = await service.markOrdered(id);
    expect(res.status).toBe('ordered');
  });

  it('explode creates one draft task per BOM material and is idempotent', async () => {
    const { service, model } = createService();
    const orderId = new Types.ObjectId();
    const productId = new Types.ObjectId();
    const materialA = new Types.ObjectId();
    const materialB = new Types.ObjectId();
    const orderCollection = { findOne: jest.fn().mockResolvedValue({
      _id: orderId,
      items: [{ productId, quantity: 2 }],
    }) };
    const productCollection = { findOne: jest.fn().mockResolvedValue({
      _id: productId,
      name: 'Product',
      composition: [
        { lineType: 'material', refId: materialA, quantity: 3 },
        { lineType: 'material', refId: materialB, quantity: 1 },
      ],
      productModuleIds: [],
    }) };
    const moduleCollection = { findOne: jest.fn() };
    model.db.collection.mockImplementation((name: string) =>
      name === 'orders' ? orderCollection : name === 'products' ? productCollection : moduleCollection,
    );
    const firstTasks = [{ _id: new Types.ObjectId(), status: 'draft' }];
    model.findOne.mockReturnValueOnce(mockQuery(null)).mockReturnValueOnce(mockQuery(null));
    model.create
      .mockResolvedValueOnce(firstTasks[0])
      .mockResolvedValueOnce({ _id: new Types.ObjectId(), status: 'draft' });

    const first = await service.explode({ orderId: orderId.toString() });
    expect(first.created).toHaveLength(2);
    expect(model.create).toHaveBeenCalledTimes(2);
    expect(model.create.mock.calls[0][0]).toEqual(expect.objectContaining({
      orderId,
      materialId: materialA,
      qty: 6,
      status: 'draft',
    }));

    model.findOne.mockReturnValueOnce(mockQuery(firstTasks[0])).mockReturnValueOnce(mockQuery(firstTasks[0]));
    const second = await service.explode({ orderId: orderId.toString() });
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toBe(2);
    expect(model.create).toHaveBeenCalledTimes(2);
  });

  describe('unconfirm (TZ-NX-SUPPLY-TASK-UNCONFIRM)', () => {
    it('reverts confirmed -> draft and clears confirmedBy/confirmedAt', async () => {
      const { service, model } = createService();
      const id = new Types.ObjectId().toString();
      const doc = {
        _id: id,
        status: 'confirmed' as const,
        confirmedBy: new Types.ObjectId(USER),
        confirmedAt: new Date(),
        save: jest.fn().mockImplementation(function (this: {
          status: string;
          confirmedBy?: Types.ObjectId;
          confirmedAt?: Date;
        }) {
          return Promise.resolve(this);
        }),
      };
      model.findOne.mockReturnValue(mockQuery(doc));

      const res = await service.unconfirm(id);

      expect(res.status).toBe('draft');
      expect(res.confirmedBy).toBeUndefined();
      expect(res.confirmedAt).toBeUndefined();
    });

    it.each(['draft', 'ordered', 'received'] as const)(
      'rejects unconfirm from %s',
      async (status) => {
        const { service, model } = createService();
        const id = new Types.ObjectId().toString();
        model.findOne.mockReturnValue(mockQuery({ _id: id, status, save: jest.fn() }));

        await expect(service.unconfirm(id)).rejects.toBeInstanceOf(BadRequestException);
      },
    );
  });

  it('findById 404', async () => {
    const { service, model } = createService();
    model.findOne.mockReturnValue(mockQuery(null));
    await expect(
      service.findById(new Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
