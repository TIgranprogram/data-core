import { Types } from 'mongoose';
import { PassportQueries } from './passport-queries';

it('C151: миниатюры страницы — draft LIVE, issued OLD, без live own; три запроса без N+1', async () => {
  const product = new Types.ObjectId(), empty = new Types.ObjectId();
  const old = new Types.ObjectId(), live = new Types.ObjectId(), showcase = new Types.ObjectId();
  const links = [
    { productId: product, purpose: 'showcase', kind: 'overview', photoId: showcase, deletedAt: null },
    { productId: product, purpose: 'passport', kind: 'overview', photoId: showcase, deletedAt: new Date() },
    { productId: product, purpose: 'passport', kind: 'overview', photoId: live, deletedAt: null },
  ];
  const queryLinks = jest.fn((q: Record<string, unknown>) => {
    expect(q).toMatchObject({ purpose: 'passport', kind: 'overview', deletedAt: null });
    expect((q.productId as { $in: unknown[] }).$in.map(String)).toEqual([String(product), String(empty)]);
    const rows = links.filter((l) => l.purpose === q.purpose && l.kind === q.kind && l.deletedAt === q.deletedAt);
    return { sort: () => ({ toArray: async () => rows }) };
  });
  const queryPhotos = jest.fn((q: { _id?: { $in: unknown[] }; parentPhotoId?: unknown }) => ({
    toArray: async () => q.parentPhotoId ? [] : (q._id?.$in ?? []).map((_id) => ({ _id, storageUrl: String(_id) === String(live) ? '/new.png' : '/old.png' })),
  }));
  const collection = jest.fn((name: string) => ({ find: name === 'productphotos' ? queryLinks : queryPhotos }));
  const queries = new PassportQueries({ connection: { collection } } as never);
  const own = [{ kind: 'overview', photoId: old, order: 0 }];
  const rows = [
    { status: 'draft', productId: product, images: own },
    { status: 'issued', productId: product, images: own },
    { status: 'draft', productId: empty, images: own },
    ...Array.from({ length: 20 }, () => ({ status: 'draft', productId: product, images: own })),
  ];
  const before = JSON.stringify(own);
  await queries.attachThumbs(rows);
  expect(rows[0]).toMatchObject({ thumb: '/new.png', photoUrl: '/new.png' });
  expect(rows[1]).toMatchObject({ thumb: '/old.png', photoUrl: '/old.png' });
  expect(rows[2]).toMatchObject({ thumb: '/old.png', photoUrl: '/old.png' });
  expect(rows.slice(3).every((r) => (r as Record<string, unknown>).thumb === '/new.png')).toBe(true);
  expect(JSON.stringify(own)).toBe(before);
  expect(queryLinks).toHaveBeenCalledTimes(1);
  expect(queryPhotos).toHaveBeenCalledTimes(2);
  expect(collection).toHaveBeenCalledTimes(2);
});
