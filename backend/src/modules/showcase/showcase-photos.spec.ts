import { Types } from 'mongoose';
import { showcasePhotos } from './showcase-photos';
import { ShowcaseService } from './showcase.service';
import type { Db, Doc } from './showcase-common';

const id = (n: number) => new Types.ObjectId(n.toString(16).padStart(24, '0'));
type Row = Record<string, unknown>;
function fixture(data: Record<string, Row[]> = {}) {
  const reads: Array<{ name: string; filter: Row }> = [];
  const equal = (a: unknown, b: unknown): boolean => b === null ? a == null : String(a) === String(b);
  const matches = (row: Row, filter: Row) => Object.entries(filter).every(([k, v]) => {
    if (k === 'images.kind') return (row.images as Row[] ?? []).some((i) => equal(i.kind, v));
    if (v && typeof v === 'object' && '$in' in v) return (v.$in as unknown[]).some((x) => equal(row[k], x));
    return equal(row[k], v);
  });
  const db = { collection: (name: string) => ({
    find: (filter: Row) => {
      reads.push({ name, filter });
      let rows = (data[name] ?? []).filter((r) => matches(r, filter));
      const cursor = {
        sort: (order: Record<string, number>) => {
          rows = [...rows].sort((a, b) => {
            for (const [key, direction] of Object.entries(order)) {
              const av = a[key] ?? 0, bv = b[key] ?? 0;
              const cmp = av < bv ? -1 : av > bv ? 1 : 0;
              if (cmp) return cmp * direction;
            }
            return 0;
          });
          return cursor;
        },
        toArray: async () => rows,
      };
      return cursor;
    },
    aggregate: () => ({ toArray: async () => [] }),
  }) } as unknown as Db;
  return { db, reads };
}
const overview = (product: number, photo: unknown, order = 0, n = 200): Row => ({ _id: id(n), productId: id(product), photoId: photo, purpose: 'passport', kind: 'overview', sortOrder: order });
const photo = (n: number, url = `/uploads/${n}.png`): Row => ({ _id: id(n), storageUrl: url });

describe('C163: резервная обложка нового изделия', () => {
  it('present отдаёт общий вид как паспортный резерв, собственный массив остаётся пустым', async () => {
    const f = fixture({ productphotos: [overview(1, id(11))], photos: [photo(11)] });
    const svc = new ShowcaseService({ db: f.db } as never, {} as never);
    const [item] = await (svc as unknown as { present(d: Doc[]): Promise<Row[]> }).present([{ _id: id(1) }]);
    expect(item).toMatchObject({ photos: [], photoSource: 'passport', photo: { id: String(id(11)), url: '/uploads/11.png' } });
  });

  it('свои фото сохраняют порядок и не читают паспортный резерв', async () => {
    const f = fixture({ photos: [photo(11), photo(12)], productphotos: [overview(1, id(13))] });
    const result = await showcasePhotos(f.db, [{ _id: id(1), photoIds: [id(12), id(11)] }]);
    expect(result.pictures.get(String(id(1)))?.map((p) => p.id)).toEqual([String(id(12)), String(id(11))]);
    expect(result.covers.size).toBe(0);
    expect(f.reads.some((r) => r.name === 'productphotos' || r.name === 'productpassports')).toBe(false);
  });

  it('выбирает живой overview по порядку, затем дате и id; не берёт прочие виды и удалённые связи', async () => {
    const f = fixture({ productphotos: [overview(1, id(11), 5),
      { ...overview(1, id(12), 0), deletedAt: new Date() },
      { ...overview(1, id(13), 0), kind: 'dimensions' },
      { ...overview(1, id(14), 0), purpose: 'showcase' },
      { ...overview(1, id(15), 1, 202), createdAt: new Date('2026-01-01') },
      { ...overview(1, id(16), 1, 201), createdAt: new Date('2026-01-01') },
      { ...overview(1, id(17), 1, 200), createdAt: new Date('2026-01-02') }],
    photos: [11, 12, 13, 14, 15, 16, 17].map((n) => photo(n)) });
    expect((await showcasePhotos(f.db, [{ _id: id(1) }])).covers.get(String(id(1)))?.id).toBe(String(id(16)));
  });

  it('битый id, отсутствующий оригинал, URL и удалённое фото пропускаются без исключения', async () => {
    const f = fixture({ productphotos: [overview(1, 'broken', 0), overview(1, id(10), 1), overview(1, id(11), 2), overview(1, id(12), 3), overview(1, id(13), 4)],
      photos: [photo(11, 'undefined'), { ...photo(12), deletedAt: new Date() }, photo(13),
        { ...photo(14, '/uploads/../bad.png'), parentPhotoId: id(13), variant: 'thumb' }] });
    const p = (await showcasePhotos(f.db, [{ _id: id(1), photoIds: ['bad'] }])).covers.get(String(id(1)));
    expect(p).toEqual({ id: String(id(13)), url: '/uploads/13.png', thumb: '/uploads/13.png' });
  });

  it('overview выше старого паспорта; без overview остаётся прежний резерв, без обоих — пусто', async () => {
    const f = fixture({ productphotos: [overview(1, id(11))], photos: [photo(11), photo(12)],
      productpassports: [1, 2].map((n) => ({ _id: id(100 + n), productId: id(n), images: [{ kind: 'overview', photoId: id(12) }] })) });
    const result = await showcasePhotos(f.db, [1, 2, 3].map((n) => ({ _id: id(n) })));
    expect(result.covers.get(String(id(1)))?.id).toBe(String(id(11)));
    expect(result.covers.get(String(id(2)))?.id).toBe(String(id(12)));
    expect(result.covers.has(String(id(3)))).toBe(false);
  });

  it('следующий импорт меняет только резерв, принятая обложка остаётся своей; чтения не растут с числом изделий', async () => {
    const data = { productphotos: [overview(1, id(11)), overview(2, id(12))], photos: [photo(11), photo(12)] };
    const f = fixture(data);
    const docs = [{ _id: id(1), photoIds: [id(11)] }, ...Array.from({ length: 40 }, (_, n) => ({ _id: id(n + 2) }))];
    const first = await showcasePhotos(f.db, docs);
    data.productphotos[0].photoId = id(12);
    data.productphotos[1].photoId = id(11);
    const second = await showcasePhotos(f.db, docs);
    expect(first.covers.get(String(id(2)))?.id).toBe(String(id(12)));
    expect(second.covers.get(String(id(2)))?.id).toBe(String(id(11)));
    expect(second.pictures.get(String(id(1)))?.[0].id).toBe(String(id(11)));
    expect(f.reads.filter((r) => r.name === 'productphotos')).toHaveLength(2);
    expect(f.reads.filter((r) => r.name === 'photos')).toHaveLength(8);
    expect((f.reads.find((r) => r.name === 'productphotos')?.filter.productId as { $in: unknown[] }).$in.map(String)).not.toContain(String(id(1)));
  });
});
