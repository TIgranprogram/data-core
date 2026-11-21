import { Types } from 'mongoose';
import { ProductPhotoService } from './product-photo.service';

describe('C172 ручная связь рисунка сериализуется с импортом', () => {
  const productId = new Types.ObjectId(), photoId = new Types.ObjectId();
  function setup(found = true) {
    const endSession = jest.fn(), session = { withTransaction: async (run: () => Promise<void>) => run(), endSession };
    const touch = jest.fn(async () => ({ matchedCount: found ? 1 : 0 }));
    const create = jest.fn(async (data: unknown, opts?: unknown) => opts ? [data] : data);
    const startSession = jest.fn(async () => session);
    const model = { db: { startSession, db: { collection: () => ({ updateOne: touch }) } }, create };
    return { svc: new ProductPhotoService(model as never), touch, create, startSession, endSession, session };
  }
  it('attach passport overview: product-touch и insert используют одну session', async () => {
    const { svc, touch, create, session, endSession } = setup();
    await svc.upsert({ productId: String(productId), photoId: String(photoId), purpose: 'passport', kind: 'overview' });
    expect(touch).toHaveBeenCalledWith({ _id: productId, deletedAt: null }, { $inc: { __v: 1 }, $set: { updatedAt: expect.any(Date) } }, { session });
    expect(create).toHaveBeenCalledWith([expect.objectContaining({ productId, photoId, purpose: 'passport', kind: 'overview' })], { session });
    expect(endSession).toHaveBeenCalledTimes(1);
  });
  it('нет живого изделия: новая связь не записана, session закрыта', async () => {
    const { svc, create, endSession } = setup(false);
    await expect(svc.upsert({ productId: String(productId), purpose: 'passport', kind: 'overview' })).rejects.toThrow('Изделие не найдено');
    expect(create).not.toHaveBeenCalled(); expect(endSession).toHaveBeenCalledTimes(1);
  });
  it('фото витрины сохраняет старый путь без транзакции', async () => {
    const { svc, touch, create, startSession } = setup();
    await svc.upsert({ productId: String(productId), photoId: String(photoId) });
    expect(create).toHaveBeenCalledTimes(1); expect(startSession).not.toHaveBeenCalled(); expect(touch).not.toHaveBeenCalled();
  });
});
