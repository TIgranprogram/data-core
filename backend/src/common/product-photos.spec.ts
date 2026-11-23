import { Types } from 'mongoose';
import { loadLinePhotos } from './photos';
import { resolveProductPhotos } from './product-photos';

type Row = Record<string, unknown>;
const id = (n: number) => new Types.ObjectId(n.toString(16).padStart(24, '0'));
const photo = (n: number, extra: Row = {}): Row => ({ _id: id(n), storageUrl: `/uploads/${n}.png`, variant: 'original', ...extra });
const link = (p: number, ph: unknown, extra: Row = {}): Row => ({ _id: id(1000 + (parseInt(String(ph).slice(-3), 16) || 0)), productId: id(p), photoId: ph, purpose: 'passport', kind: 'overview', sortOrder: 0, ...extra });

function fixture(data: Record<string, Row[]>) {
  const reads: Array<{ name: string; filter: Row }> = [];
  const equal = (a: unknown, b: unknown) => b === null ? a == null : String(a) === String(b);
  const matches = (r: Row, f: Row) => Object.entries(f).every(([key, value]) => {
    if (key === 'images.kind') return (r.images as Row[] ?? []).some((i) => equal(i.kind, value));
    if (value && typeof value === 'object' && '$in' in value) return (value.$in as unknown[]).some((v) => equal(r[key], v));
    return equal(r[key], value);
  });
  const db = { collection: (name: string) => ({ find: (filter: Row) => {
    reads.push({ name, filter });
    let rows = (data[name] ?? []).filter((r) => matches(r, filter));
    const cursor = { sort: (order: Record<string, number>) => { rows = [...rows].sort((a, b) => {
      for (const [key, dir] of Object.entries(order)) { const x = a[key] ?? 0, y = b[key] ?? 0; if (x !== y) return (x < y ? -1 : 1) * dir; }
      return 0;
    }); return cursor; }, toArray: async () => rows };
    return cursor;
  } }) };
  return { db: db as never, reads, data };
}

describe('C244 — единый batch resolver фото строки и каталога', () => {
  it('3413: пустые own/catalogue → живой passportoverview; чтение данных не меняет', async () => {
    const f = fixture({ products: [{ _id: id(1), photoIds: [] }], productphotos: [link(1, id(11))], photos: [photo(11)] });
    const before = JSON.stringify(f.data);
    const line = { _id: id(20), productId: id(1), photoIds: [] };
    expect((await loadLinePhotos(f.db, [line])).get(String(line._id))).toEqual({ url: '/uploads/11.png', thumb: '/uploads/11.png' });
    expect(JSON.stringify(f.data)).toBe(before);
    expect(f.reads).toHaveLength(5); // products + links/passports + originals/variants, не по числу строк.
  });
  it('оригинал КП позиции выше каталога/overview; каталог сохраняет явный порядок', async () => {
    const f = fixture({ products: [{ _id: id(1), photoIds: [id(13), id(12)] }], productphotos: [link(1, id(11))], photos: [11, 12, 13, 14].map((n) => photo(n)) });
    const result = await loadLinePhotos(f.db, [{ _id: id(20), productId: id(1), photoIds: [id(14)] }, { _id: id(21), productId: id(1) }]);
    expect(result.get(String(id(20)))?.url).toBe('/uploads/14.png');
    expect(result.get(String(id(21)))?.url).toBe('/uploads/13.png');
    expect(f.reads.some((r) => r.name === 'productphotos')).toBe(false);
  });
  it('битые/deleted/unsafe/variant own и каталог пропускаются; следующий пригодный оригинал остаётся', async () => {
    const f = fixture({ products: [{ _id: id(1), photoIds: [id(12), id(13)] }], photos: [photo(10, { deletedAt: new Date() }), photo(11, { storageUrl: '/uploads/../bad.png' }), photo(12, { variant: 'thumb', parentPhotoId: id(99) }), photo(13)] });
    expect((await loadLinePhotos(f.db, [{ _id: id(20), productId: id(1), photoIds: ['bad', id(10), id(11)] }])).get(String(id(20)))?.url).toBe('/uploads/13.png');
  });
  it('не берёт чужойproduct, другиеpurpose/kind, deletedlinks/photos и unsafevariants; идёт к следующемуoverview', async () => {
    const f = fixture({ products: [{ _id: id(1) }], productphotos: [link(2, id(10)), link(1, id(11), { kind: 'dimensions' }), link(1, id(12), { kind: 'mounting' }), link(1, id(13), { purpose: 'showcase' }), link(1, id(14), { deletedAt: new Date() }), link(1, id(15)), link(1, id(16)), link(1, 'bad'), link(1, id(17), { sortOrder: 10 })],
      photos: [photo(10), photo(11), photo(12), photo(13), photo(14), photo(15, { deletedAt: new Date() }), photo(16, { storageUrl: 'https://other/photo.png' }), photo(17), photo(18, { variant: 'thumb', parentPhotoId: id(17), storageUrl: '/uploads/../bad.png' }), photo(19, { variant: 'thumb', parentPhotoId: id(17), deletedAt: new Date() })] });
    expect((await loadLinePhotos(f.db, [{ _id: id(20), productId: id(1) }])).get(String(id(20)))).toEqual({ url: '/uploads/17.png', thumb: '/uploads/17.png' });
  });
  it('legacyoverview остаётся резервом после актуальных ссылок; mainPhotoId не добавляется как новый источник', async () => {
    const f = fixture({ products: [{ _id: id(1), mainPhotoId: id(10) }, { _id: id(2), mainPhotoId: id(10) }], productpassports: [{ _id: id(50), productId: id(1), date: new Date('2026-01-01'), images: [{ kind: 'overview', photoId: id(11) }] }, { _id: id(51), productId: id(1), date: new Date('2026-02-01'), images: [{ kind: 'overview', photoId: id(12) }] }], photos: [photo(10), photo(11), photo(12)] });
    const result = await loadLinePhotos(f.db, [{ _id: id(20), productId: id(1) }, { _id: id(21), productId: id(2) }]);
    expect(result.get(String(id(20)))?.url).toBe('/uploads/12.png');
    expect(result.get(String(id(21)))).toBeNull();
  });
  it('смена product A→B не оставляет A; удалённый/invalid/noimageproduct безопасно даёт null', async () => {
    const f = fixture({ products: [{ _id: id(1) }, { _id: id(2) }, { _id: id(3), photoIds: [id(13)], deletedAt: new Date() }], productphotos: [link(1, id(11)), link(2, id(12))], photos: [photo(11), photo(12), photo(13)] });
    const line = { _id: id(20), productId: id(1) };
    expect((await loadLinePhotos(f.db, [line])).get(String(line._id))?.url).toBe('/uploads/11.png');
    line.productId = id(2);
    expect((await loadLinePhotos(f.db, [line])).get(String(line._id))?.url).toBe('/uploads/12.png');
    const absent = await loadLinePhotos(f.db, [{ _id: id(21), productId: 'invalid' }, { _id: id(22), productId: id(3) }, { _id: id(23) }]);
    expect([...absent.values()]).toEqual([null, null, null]);
  });
  it('пустой набор не читает БД;100строк общего изделия требуют те же5batch-запросов', async () => {
    const f = fixture({ products: [{ _id: id(1) }], productphotos: [link(1, id(11))], photos: [photo(11)] });
    expect((await loadLinePhotos(f.db, [])).size).toBe(0);
    expect(f.reads).toHaveLength(0);
    const lines = Array.from({ length: 100 }, (_, i) => ({ _id: id(100 + i), productId: id(1) }));
    const result = await loadLinePhotos(f.db, lines);
    expect(result.size).toBe(100);
    expect([...result.values()].every((p) => p?.url === '/uploads/11.png')).toBe(true);
    expect(f.reads).toHaveLength(5);
    expect(f.reads.find((r) => r.name === 'products')?.filter).toMatchObject({ _id: { $in: [id(1)] }, deletedAt: null });
  });
  it('adapter сохраняет pictures толькоявные и covers резервом без новогоформата', async () => {
    const f = fixture({ photos: [photo(11), photo(12), photo(13, { parentPhotoId: id(12), variant: 'thumb' })], productphotos: [link(2, id(12))] });
    const result = await resolveProductPhotos(f.db, [{ _id: id(1), photoIds: [id(11)] }, { _id: id(2), photoIds: [] }]);
    expect(result.pictures.get(String(id(1)))?.[0].id).toBe(String(id(11)));
    expect(result.pictures.get(String(id(2)))).toEqual([]);
    expect(result.covers.get(String(id(2)))).toMatchObject({ id: String(id(12)), url: '/uploads/12.png', thumb: '/uploads/13.png' });
  });
});
