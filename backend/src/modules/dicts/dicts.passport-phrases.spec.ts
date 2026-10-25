import { Types } from 'mongoose';
import { DICT } from './dicts.defs';

/** «Тексты паспорта» (дерево воронки): проверки при записи и удаление узла с вариантами. */
type Row = Record<string, unknown>;
const oid = () => new Types.ObjectId();
function fakeDb(rows: Row[]) {
  const ok = (r: Row, q: Row) => Object.entries(q).every(([k, v]) => (v === null ? r[k] == null : String(r[k]) === String(v)));
  return { collection: () => ({ find: (q: Row) => ({ toArray: async () => rows.filter((r) => ok(r, q)) }), countDocuments: async (q: Row) => rows.filter((r) => ok(r, q)).length }) } as never;
}
const d = DICT.get('passportPhrases')!;
const root = { _id: oid(), dict: 'passportPhrases', name: 'Монтаж', section: 'mounting', parentId: null, deletedAt: null };
const leaf = { _id: oid(), dict: 'passportPhrases', name: 'Анкерное', section: 'mounting', parentId: root._id, text: 'Анкерами.', deletedAt: null };
const db = fakeDb([root, leaf]);

describe('passportPhrases: toDoc', () => {
  it('новый раздел: нужен ключ раздела, текста у него быть не может', async () => {
    await expect(d.toDoc({ name: 'Вопрос' }, true, db)).rejects.toThrow(/Укажите раздел/);
    await expect(d.toDoc({ name: 'Вопрос', section: 'mounting', text: 'Текст' }, true, db)).rejects.toThrow(/без текста/);
    const doc = await d.toDoc({ name: 'Вопрос', section: 'mounting', required: 'true', slot: '2' }, true, db);
    expect(doc).toEqual(expect.objectContaining({ parentId: null, section: 'mounting', required: true, slot: 2, text: null, funnelV: 1, dict: 'passportPhrases' }));
  });
  it('вариант: раздел берётся от корня, категории и «Для всех» сохраняются', async () => {
    const doc = await d.toDoc({ name: 'Бетон', parentId: String(root._id), text: 'Бетоном.', categories: 'TRN, WRK', allCategories: 'true' }, true, db);
    expect(doc).toEqual(expect.objectContaining({ section: 'mounting', categories: 'TRN, WRK', allCategories: true, required: null, slot: null }));
    expect(String(doc.parentId)).toBe(String(root._id));
  });
  it('под листом с текстом вариантов нет; несуществующий родитель; в себя нельзя', async () => {
    await expect(d.toDoc({ name: 'Под', parentId: String(leaf._id), text: 'Т.' }, true, db)).rejects.toThrow(/есть текст/);
    await expect(d.toDoc({ name: 'Под', parentId: String(oid()), text: 'Т.' }, true, db)).rejects.toThrow(/Родитель не найден/);
    await expect(d.toDoc({ name: 'Монтаж', parentId: String(leaf._id) }, false, db, String(root._id))).rejects.toThrow(/в самого себя/);
  });
  it('у узла с вариантами текста нет', async () => {
    await expect(d.toDoc({ name: 'Монтаж', text: 'Текст' }, false, db, String(root._id))).rejects.toThrow(/конечном варианте/);
  });
  it('правка без поля не стирает его (категории остаются)', async () => {
    const withCats = fakeDb([root, { ...leaf, categories: 'TRN' }]);
    const doc = await d.toDoc({ name: 'Анкерное' }, false, withCats, String(leaf._id));
    expect(doc).toEqual(expect.objectContaining({ categories: 'TRN', text: 'Анкерами.' }));
  });
});

describe('passportPhrases: удаление и дубли', () => {
  it('узел с вариантами в корзину нельзя', async () => {
    await expect(d.beforeRemove!(db, root as never)).rejects.toThrow(/сначала уберите варианты/);
    await expect(d.beforeRemove!(db, leaf as never)).resolves.toBeUndefined();
  });
  it('одинаковое название под разными разделами — не дубль', () => {
    expect(d.dupKey!({ ...leaf, parentId: oid() } as never)).not.toBe(d.dupKey!(leaf as never));
  });
});
