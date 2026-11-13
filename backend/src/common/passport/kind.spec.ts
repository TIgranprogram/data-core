import { Types } from 'mongoose';
import { kindPatch, resolveKind, resolveKinds } from './kind';

type Row = Record<string, unknown>;
const oid = () => new Types.ObjectId();

/** Фальшивая БД с простым отбором: равенство, null = «нет поля», $in по _id, $ne. */
function fakeDb(cols: Record<string, Row[]>) {
  const ok = (r: Row, q: Row) => Object.entries(q).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in (v as Row)) return ((v as { $in: unknown[] }).$in).some((x) => String(x) === String(r[k]));
    if (v && typeof v === 'object' && '$ne' in (v as Row)) return String(r[k] ?? null) !== String((v as { $ne: unknown }).$ne);
    return v === null ? r[k] == null : String(r[k]) === String(v);
  });
  return { collection: (n: string) => ({
    find: (q: Row) => ({ toArray: async () => (cols[n] ?? []).filter((r) => ok(r, q)) }),
    findOne: async (q: Row) => (cols[n] ?? []).find((r) => ok(r, q)) ?? null,
  }) } as never;
}

const el = oid();
const root = { _id: oid(), dict: 'passportPhrases', section: 'purpose', parentId: null, name: 'Назначение', deletedAt: null };
const leaf = { _id: oid(), dict: 'passportPhrases', section: 'purpose', parentId: root._id, name: 'Отдых', text: 'Для отдыха.', deletedAt: null };
const kind = (over: Row = {}) => ({ _id: oid(), dict: 'passportKinds', name: 'Скамья', passportCategory: 'BLG', elementIds: [el], purposeLeafId: leaf._id, deletedAt: null, ...over });
const parent = oid();
const group = (k?: Row) => ({ _id: oid(), name: 'Скамьи', parentId: parent, ...(k ? { passportKindId: k._id } : {}) });

describe('C100: вид изделия — resolveKind', () => {
  it('вид группы: источник «group», имя группы', async () => {
    const k = kind(), g = group(k);
    const r = await resolveKind(fakeDb({ categories: [g], dict_values: [k] }), { _id: oid(), categoryId: g._id });
    expect(r).toMatchObject({ source: 'group', groupName: 'Скамьи', kind: { id: String(k._id), name: 'Скамья', passportCategory: 'BLG', elementIds: [String(el)], purposeLeafId: String(leaf._id) } });
  });
  it('своё у изделия главнее вида группы', async () => {
    const k1 = kind({ name: 'Лавка' }), k2 = kind(), g = group(k2);
    const r = await resolveKind(fakeDb({ categories: [g], dict_values: [k1, k2] }), { _id: oid(), categoryId: g._id, passportDefaults: { kindId: String(k1._id) } });
    expect(r).toMatchObject({ source: 'own', kind: { name: 'Лавка' } });
  });
  it('нет ни своего, ни вида группы — вида нет', async () => {
    const g = group();
    expect(await resolveKind(fakeDb({ categories: [g], dict_values: [] }), { _id: oid(), categoryId: g._id })).toEqual({ kind: null, source: null, groupName: 'Скамьи' });
    expect((await resolveKind(fakeDb({}), { _id: oid() })).kind).toBeNull();
  });
  it('удалённый вид — как будто его нет; битое своё уступает виду группы', async () => {
    const dead = kind({ deletedAt: new Date() }), live = kind(), g = group(live);
    expect((await resolveKind(fakeDb({ categories: [group(dead)], dict_values: [dead] }), { _id: oid(), categoryId: group(dead)._id })).kind).toBeNull();
    const r = await resolveKind(fakeDb({ categories: [g], dict_values: [dead, live] }), { _id: oid(), categoryId: g._id, passportDefaults: { kindId: String(dead._id) } });
    expect(r).toMatchObject({ source: 'group', kind: { id: String(live._id) } });
  });
  it('раздел без родителя группой не считается: вид раздела не берётся', async () => {
    const k = kind(), section = { _id: oid(), name: 'Раздел', parentId: null, passportKindId: k._id };
    expect(await resolveKind(fakeDb({ categories: [section], dict_values: [k] }), { _id: oid(), categoryId: section._id })).toEqual({ kind: null, source: null, groupName: '' });
  });
  it('пачкой: один результат на изделие', async () => {
    const k = kind(), g = group(k), p1 = { _id: oid(), categoryId: g._id }, p2 = { _id: oid() };
    const m = await resolveKinds(fakeDb({ categories: [g], dict_values: [k] }), [p1, p2]);
    expect(m.get(String(p1._id))?.source).toBe('group');
    expect(m.get(String(p2._id))?.kind).toBeNull();
  });
});

describe('C100: kindPatch — что вид добавляет в паспорт', () => {
  const db = (k: Row) => fakeDb({ dict_values: [root, leaf, k] });
  it('элементы и назначение вида, если своих нет', async () => {
    const k = kind();
    const rk = await resolveKind(fakeDb({ categories: [], dict_values: [k] }), { _id: oid(), passportDefaults: { kindId: String(k._id) } });
    const patch = await kindPatch(db(k), { passportDefaults: { kindId: String(k._id) } }, rk);
    expect(patch.elements?.map(String)).toEqual([String(el)]);
    expect(patch.textChoices).toEqual({ [String(root._id)]: String(leaf._id) });
  });
  it('своё главнее: свои элементы и свой выбор назначения не заменяются', async () => {
    const k = kind(), other = oid();
    const rk = { kind: { id: String(k._id), name: 'Скамья', passportCategory: 'BLG', elementIds: [String(el)], purposeLeafId: String(leaf._id) }, source: 'own' as const, groupName: '' };
    const patch = await kindPatch(db(k), { passportDefaults: { elements: [oid()], textChoices: { [String(root._id)]: String(other) } } }, rk);
    expect(patch).toEqual({});
  });
  it('удалённый лист назначения не подставляется; вида нет — пусто', async () => {
    const k = kind({ purposeLeafId: oid() });
    const rk = { kind: { id: String(k._id), name: 'Скамья', passportCategory: '', elementIds: [], purposeLeafId: String(k.purposeLeafId) }, source: 'group' as const, groupName: '' };
    expect(await kindPatch(db(k), {}, rk)).toEqual({});
    expect(await kindPatch(db(k), {}, { kind: null, source: null, groupName: '' })).toEqual({});
  });
});
