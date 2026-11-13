import { Types } from 'mongoose';
import { DICT } from './dicts.defs';

/** «Группы изделий»: номер группы (две цифры, уникален, после записи не меняется), раздел, удаление. */
type Row = Record<string, unknown>;
const oid = () => new Types.ObjectId();
function fakeDb(rows: Row[], products: Row[] = []) {
  const ok = (r: Row, q: Row) => Object.entries(q).every(([k, v]) => {
    if (v && typeof v === 'object' && '$ne' in (v as Row)) return String(r[k] ?? null) !== String((v as Row).$ne);
    return v === null ? r[k] == null : String(r[k]) === String(v);
  });
  const coll = (list: Row[]) => ({ findOne: async (q: Row) => list.find((r) => ok(r, q)) ?? null, countDocuments: async (q: Row) => list.filter((r) => ok(r, q)).length });
  return { collection: (n: string) => coll(n === 'products' ? products : rows) } as never;
}
const sec = { _id: oid(), name: 'Спорт', type: 'product', parentId: null, deletedAt: null };
const workout = { _id: oid(), name: 'Воркаут', type: 'product', parentId: sec._id, groupNo: '12', slug: 'workout', skuPrefix: 'WOR', deletedAt: null };
const legacy = { _id: oid(), name: 'Старая', type: 'product', parentId: sec._id, deletedAt: null };
const g = DICT.get('productGroups')!;

describe('productGroups: toDoc', () => {
  const db = fakeDb([sec, workout, legacy]);
  it('новая группа: slug/skuPrefix для CRM, номер, раздел', async () => {
    const doc = await g.toDoc({ name: 'Скамьи', groupNo: '34', parentId: String(sec._id) }, true, db);
    expect(doc).toEqual(expect.objectContaining({ name: 'Скамьи', groupNo: '34', type: 'product', slug: 'skami', isActive: true, deletedAt: null }));
    expect(String(doc.parentId)).toBe(String(sec._id));
    expect(doc.skuPrefix).toBeTruthy();
  });
  it('формат номера: ровно две цифры', async () => {
    for (const bad of ['1', '123', 'ab', '']) await expect(g.toDoc({ name: 'Х', groupNo: bad, parentId: String(sec._id) }, true, db)).rejects.toThrow(/номер/i);
  });
  it('номер занят другой группой — понятная ошибка', async () => {
    await expect(g.toDoc({ name: 'Другая', groupNo: '12', parentId: String(sec._id) }, true, db)).rejects.toThrow('Номер 12 уже занят группой «Воркаут»');
  });
  it('нужен существующий раздел', async () => {
    await expect(g.toDoc({ name: 'Х', groupNo: '40' }, true, db)).rejects.toThrow(/раздел/i);
    await expect(g.toDoc({ name: 'Х', groupNo: '40', parentId: String(oid()) }, true, db)).rejects.toThrow(/Раздел не найден/);
  });
  it('номер существующей группы не меняется; без поля остаётся; сама себе не мешает', async () => {
    await expect(g.toDoc({ name: 'Воркаут', groupNo: '15' }, false, db, String(workout._id))).rejects.toThrow(/нельзя менять/);
    const doc = await g.toDoc({ name: 'Воркаут 2' }, false, db, String(workout._id));
    expect(doc).toEqual(expect.objectContaining({ name: 'Воркаут 2', groupNo: '12' }));
    expect(String(doc.parentId)).toBe(String(sec._id));
  });
  it('старой группе без номера номер можно задать (один раз)', async () => {
    await expect(g.toDoc({ name: 'Старая', groupNo: '12' }, false, db, String(legacy._id))).rejects.toThrow(/уже занят/);
    expect(await g.toDoc({ name: 'Старая', groupNo: '50' }, false, db, String(legacy._id))).toEqual(expect.objectContaining({ groupNo: '50' }));
  });
});

describe('productGroups: удаление', () => {
  it('группу с изделиями удалить нельзя', async () => {
    const db = fakeDb([sec, workout], [{ categoryId: workout._id, deletedAt: null }]);
    await expect(g.beforeRemove!(db, workout as never)).rejects.toThrow(/есть изделия \(1\)/);
    await expect(g.beforeRemove!(fakeDb([sec, workout]), workout as never)).resolves.toBeUndefined();
  });
  it('раздел с группами удалить нельзя', async () => {
    await expect(DICT.get('productSections')!.beforeRemove!(fakeDb([sec, workout]), sec as never)).rejects.toThrow(/есть группы \(1\)/);
  });
});

describe('passportKinds: «Виды изделий» (C100)', () => {
  const k = DICT.get('passportKinds')!;
  const kind = { _id: oid(), dict: 'passportKinds', name: 'Урна', deletedAt: null };
  const leaf = { _id: oid(), dict: 'passportPhrases', name: 'Сбор мусора', parentId: oid(), deletedAt: null };
  const counts = (groups: number, prods: number) => ({
    collection: (n: string) => ({
      aggregate: () => ({ toArray: async () => (n === 'categories' ? (groups ? [{ _id: kind._id, n: groups }] : []) : prods ? [{ _id: String(kind._id), n: prods }] : []) }),
      findOne: async (q: Row) => (n === 'dict_values' && q.parentId ? null : leaf),
    }),
  }) as never;
  it('удалить вид, заданный группе или изделию, нельзя (409)', async () => {
    await expect(k.beforeRemove!(counts(1, 0), kind as never)).rejects.toThrow(/удалить нельзя/);
    await expect(k.beforeRemove!(counts(0, 2), kind as never)).rejects.toThrow(/\(2\)/);
    await expect(k.beforeRemove!(counts(0, 0), kind as never)).resolves.toBeUndefined();
  });
  it('запись: не больше трёх элементов; категория из списка; назначение — конечный вариант', async () => {
    const ids = () => [oid(), oid(), oid(), oid()].map(String);
    await expect(k.toDoc({ name: 'Х', elementIds: ids() }, true, counts(0, 0))).rejects.toThrow(/не больше 3/);
    await expect(k.toDoc({ name: 'Х', passportCategory: 'ZZZ' }, true, counts(0, 0))).rejects.toThrow(/Тип паспорта/);
    const doc = await k.toDoc({ name: ' Урна ', passportCategory: 'BLG', elementIds: ids().slice(0, 2), purposeLeafId: String(leaf._id) }, true, counts(0, 0));
    expect(doc).toMatchObject({ dict: 'passportKinds', name: 'Урна', passportCategory: 'BLG' });
    expect((doc.elementIds as unknown[]).length).toBe(2);
  });
});
