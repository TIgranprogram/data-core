import { PassportQueries, choiceMissingIn } from "./passport-queries";
import { buildForest, type PhraseNode } from '../../common/passport/phrase-tree';

/** Список паспортов учитывает обязательные разделы воронки у черновиков (как карточка), дерево — один раз на категорию. */
const hex = (n: number) => String(n).padStart(24, '0');
const node = (o: Partial<PhraseNode> & { name: string; id: string }): PhraseNode => ({ parentId: null, section: 'installation', text: '', categories: '', allCategories: true, order: 0, required: false, isDefault: false, installTypeId: null, slot: 1, ...o });
const root = node({ id: hex(1), name: 'Как крепится', required: true });
const forest = buildForest([root, node({ id: hex(2), name: 'А', parentId: root.id, text: 'Анкер.' }), node({ id: hex(3), name: 'Б', parentId: root.id, text: 'Бетон.', order: 1 })], 'TRN');

describe('choiceMissingIn', () => {
  it('раздел без выбора — пункт; выбор или ручной текст закрывает', () => {
    expect(choiceMissingIn(forest, {}).map((m) => m.key)).toEqual([`choice:${root.id}`]);
    expect(choiceMissingIn(forest, { textChoices: { [root.id]: hex(2) } })).toEqual([]);
    expect(choiceMissingIn(forest, { manualText: ['installationMethod'] })).toEqual([]);
  });
});

describe('PassportQueries.list: воронка', () => {
  it('черновик получает choice-пункт, выпущенный — нет; дерево грузится раз на категорию', async () => {
    const docs = [{ _id: 1, status: 'draft', passportCategory: 'TRN' }, { _id: 2, status: 'draft', passportCategory: 'TRN' }, { _id: 3, status: 'issued', passportCategory: 'TRN' }];
    const chain = { setOptions: () => chain, sort: () => chain, lean: () => chain, exec: async () => docs };
    const forestFn = jest.fn(async () => forest);
    const q = new PassportQueries({ model: { find: () => chain } as never, connection: {} as never, categoryRules: async () => new Map(), installs: async () => new Map(), withSchemes: (d) => d, oid: (v) => v as never, forest: forestFn });
    const r = await q.list({ limit: '50' });
    const byId = new Map(r.items.map((i) => [i._id, i.missing as string[]]));
    expect(byId.get(1)).toContain('Выбор: Как крепится');
    expect(byId.get(2)).toContain('Выбор: Как крепится');
    expect(byId.get(3)).not.toContain('Выбор: Как крепится');
    expect(forestFn).toHaveBeenCalledTimes(1);
  });
});
