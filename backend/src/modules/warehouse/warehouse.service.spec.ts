import { Types } from 'mongoose';
import { WarehouseService } from './warehouse.service';

function mockQuery<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function createService() {
  const model = {
    create: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
  };
  const storageModel = {};
  const movementModel = {};
  const service = new WarehouseService(model as never, storageModel as never, movementModel as never);
  return { service, model };
}

const savedDoc = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  name: 'Основной склад',
  type: 'main',
  isActive: true,
  isDefault: false,
  zoneNames: [],
  roleIds: [],
  save: jest.fn().mockImplementation(function (this: Record<string, unknown>) {
    return Promise.resolve(this);
  }),
  ...overrides,
});

describe('WarehouseService (TZ-NX-WAREHOUSE-DEFAULT)', () => {
  it('create defaults isDefault=false when not requested', async () => {
    const { service, model } = createService();
    model.create.mockResolvedValue(savedDoc());

    await service.create({ name: 'Металл' });

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ isDefault: false }),
    );
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it('create with isDefault=true clears other defaults and saves this one as default', async () => {
    const { service, model } = createService();
    const id = new Types.ObjectId();
    const doc = savedDoc({ _id: id });
    model.create.mockResolvedValue(doc);
    model.findById.mockReturnValue(mockQuery(doc));

    const res = await service.create({ name: 'Металл', isDefault: true });

    expect(model.updateMany).toHaveBeenCalledWith(
      { _id: { $ne: id } },
      { $set: { isDefault: false } },
    );
    expect(res.isDefault).toBe(true);
  });

  it('setDefault atomically unsets others and sets the target', async () => {
    const { service, model } = createService();
    const id = new Types.ObjectId();
    const doc = savedDoc({ _id: id, isDefault: false });
    model.findById.mockReturnValue(mockQuery(doc));

    const res = await service.setDefault(id.toString());

    expect(model.updateMany).toHaveBeenCalledWith(
      { _id: { $ne: id } },
      { $set: { isDefault: false } },
    );
    expect(res.isDefault).toBe(true);
  });

  it('update with isDefault=true clears other defaults before saving', async () => {
    const { service, model } = createService();
    const id = new Types.ObjectId();
    const doc = savedDoc({ _id: id, isDefault: false });
    model.findById.mockReturnValue(mockQuery(doc));

    const res = await service.update(id.toString(), { isDefault: true });

    expect(model.updateMany).toHaveBeenCalledWith(
      { _id: { $ne: id } },
      { $set: { isDefault: false } },
    );
    expect(res.isDefault).toBe(true);
  });

  it('update with isDefault=false just unsets this one (no updateMany)', async () => {
    const { service, model } = createService();
    const id = new Types.ObjectId();
    const doc = savedDoc({ _id: id, isDefault: true });
    model.findById.mockReturnValue(mockQuery(doc));

    const res = await service.update(id.toString(), { isDefault: false });

    expect(model.updateMany).not.toHaveBeenCalled();
    expect(res.isDefault).toBe(false);
  });

  it('findDefault returns the current default warehouse or null', async () => {
    const { service, model } = createService();
    const doc = savedDoc({ isDefault: true });
    model.findOne.mockReturnValue(mockQuery(doc));

    const res = await service.findDefault();

    expect(model.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ isDefault: true }),
    );
    expect(res).toEqual(doc);
  });
});
