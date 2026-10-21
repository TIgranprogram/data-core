import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DictionaryLabelService } from './dictionary-label.service';

const ORG = new Types.ObjectId().toHexString();

function query<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function label(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    scope: 'productKind',
    key: 'service',
    label: 'Услуга',
    sortOrder: 1,
    isActive: true,
    isSystem: true,
    organizationId: null,
    save: jest.fn().mockImplementation(function (this: unknown) {
      return Promise.resolve(this);
    }),
    ...overrides,
  };
}

function build() {
  const model = {
    findOne: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
  } as any;
  return { service: new DictionaryLabelService(model), model };
}

describe('DictionaryLabelService (TZ-DICT-319)', () => {
  it('seeds product and material labels idempotently', async () => {
    const { service, model } = build();
    model.findOne.mockReturnValue(query(null));
    model.create.mockResolvedValue(label());

    await service.onApplicationBootstrap();
    expect(model.create).toHaveBeenCalledTimes(8);
    model.findOne.mockReturnValue(query(label()));
    await service.onApplicationBootstrap();
    expect(model.create).toHaveBeenCalledTimes(8);
  });

  it('lists labels with organization plus global scope', async () => {
    const { service, model } = build();
    model.find.mockReturnValue(query([]));
    await service.list('productKind', ORG);
    expect(model.find).toHaveBeenCalledWith({
      scope: 'productKind',
      $or: [{ organizationId: new Types.ObjectId(ORG) }, { organizationId: null }],
    });
  });

  it('active endpoint adds the isActive filter', async () => {
    const { service, model } = build();
    model.find.mockReturnValue(query([]));
    await service.active('materialKind', ORG);
    expect(model.find).toHaveBeenCalledWith({
      scope: 'materialKind',
      $or: [{ organizationId: new Types.ObjectId(ORG) }, { organizationId: null }],
      isActive: true,
    });
  });

  it('renames a seeded label without changing its stable key', async () => {
    const { service, model } = build();
    const doc = label();
    model.findById.mockReturnValue(query(doc));
    const result = await service.update(doc._id.toString(), { label: 'Услуги цеха' }, ORG);
    expect(result.key).toBe('service');
    expect(result.label).toBe('Услуги цеха');
    expect(doc.save).toHaveBeenCalled();
  });

  it('allows active state and sort order patching', async () => {
    const { service, model } = build();
    const doc = label();
    model.findById.mockReturnValue(query(doc));
    await service.update(doc._id.toString(), { isActive: false, sortOrder: 9 }, ORG);
    expect(doc.isActive).toBe(false);
    expect(doc.sortOrder).toBe(9);
  });

  it('maps duplicate identity errors to ConflictException', async () => {
    const { service, model } = build();
    const doc = label({ save: jest.fn().mockRejectedValue({ code: 11000 }) });
    model.findById.mockReturnValue(query(doc));
    await expect(service.update(doc._id.toString(), { label: 'Дубликат' }, ORG)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('blocks foreign organization overrides', async () => {
    const { service, model } = build();
    const doc = label({ organizationId: new Types.ObjectId() });
    model.findById.mockReturnValue(query(doc));
    await expect(service.update(doc._id.toString(), { label: 'Взлом' }, ORG)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
