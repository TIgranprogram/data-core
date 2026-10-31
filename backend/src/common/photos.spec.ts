import { Types } from 'mongoose';
import { loadLinePhotos, linePhotoId } from './photos';

const oid = () => new Types.ObjectId();

describe('фото строки позиции', () => {
  it('источник: своё → фото изделия → null', () => {
    const own = oid(), prodPh = oid(), prod = oid();
    const first = new Map<string, unknown>([[String(prod), prodPh]]);
    expect(linePhotoId({ photoIds: [own], productId: prod }, first)).toBe(String(own));
    expect(linePhotoId({ photoIds: [], productId: prod }, first)).toBe(String(prodPh));
    expect(linePhotoId({ productId: oid() }, first)).toBeNull();
    expect(linePhotoId({}, first)).toBeNull();
  });

  it('loadLinePhotos: пачкой, свои и изделия, без фото — null', async () => {
    const ownId = oid(), prodPhId = oid(), prodId = oid();
    const photos = [{ _id: ownId, storageUrl: '/own.jpg' }, { _id: prodPhId, storageUrl: '/prod.jpg' }];
    const find = (rows: unknown[]) => ({ toArray: async () => rows });
    const db = {
      collection: (name: string) => ({
        find: (q: Record<string, unknown>) => {
          if (name === 'products') return find([{ _id: prodId, photoIds: [prodPhId] }]);
          // второй запрос photos — миниатюры (фильтр по parentPhotoId)
          return find('parentPhotoId' in q ? [] : photos);
        },
      }),
    };
    const l1 = { _id: oid(), photoIds: [ownId] }, l2 = { _id: oid(), productId: prodId }, l3 = { _id: oid() };
    const r = await loadLinePhotos(db as never, [l1, l2, l3]);
    expect(r.get(String(l1._id))).toEqual({ url: '/own.jpg', thumb: '/own.jpg' });
    expect(r.get(String(l2._id))).toEqual({ url: '/prod.jpg', thumb: '/prod.jpg' });
    expect(r.get(String(l3._id))).toBeNull();
  });
});
