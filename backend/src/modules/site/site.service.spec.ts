import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SiteService } from './site.service';

function mockQuery<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function createService(overrides: Record<string, unknown> = {}) {
  const model = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
  };
  const service = new SiteService(model as never);
  Object.assign(service, overrides);
  return { service, model };
}

describe('SiteService (TZ-ORDERS-303)', () => {
  const CP = new Types.ObjectId().toString();

  it('create stores counterparty + name + address', async () => {
    const { service, model } = createService();
    const doc = { _id: new Types.ObjectId(), counterpartyId: CP, name: 'Цех', address: 'ул. 1' };
    model.create.mockResolvedValue(doc);
    const res = await service.create({ counterpartyId: CP, name: ' Цех ', address: ' ул. 1 ' });
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Цех',
        address: 'ул. 1',
        isActive: true,
      }),
    );
    expect(res).toBe(doc);
  });

  it('assertBelongsTo rejects foreign site', async () => {
    const { service, model } = createService();
    const siteId = new Types.ObjectId().toString();
    model.findOne.mockReturnValue(
      mockQuery({
        _id: siteId,
        counterpartyId: new Types.ObjectId(),
      }),
    );
    await expect(service.assertBelongsTo(siteId, CP)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ensureDefaultForCounterparty creates when empty', async () => {
    const { service, model } = createService();
    model.find.mockReturnValue(mockQuery([]));
    const created = { _id: new Types.ObjectId(), name: 'Объект по умолчанию' };
    model.create.mockResolvedValue(created);
    const res = await service.ensureDefaultForCounterparty(CP, 'Адрес КП');
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Объект по умолчанию',
        address: 'Адрес КП',
      }),
    );
    expect(res).toBe(created);
  });

  it('findById 404', async () => {
    const { service, model } = createService();
    model.findOne.mockReturnValue(mockQuery(null));
    await expect(service.findById(new Types.ObjectId().toString())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
