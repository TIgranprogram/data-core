import { BadRequestException } from '@nestjs/common';
import { buildForest, checkChoices, checkNode, depthOf, missingChoices, parseChoices, presentForest, resolveChoices, toNode, type PhraseNode } from './phrase-tree';

/** Дерево текстов паспорта (воронка, ПВ): видимость, глубина, автовыбор единственного, проверки. */
const hex = (n: number) => String(n).padStart(24, '0');
let k = 0;
const node = (o: Partial<PhraseNode> & { name: string }): PhraseNode => ({ id: hex(++k), parentId: null, section: 'installation', text: '', categories: '', allCategories: false, order: 0, required: false, isDefault: false, installTypeId: null, slot: 1, ...o });

describe('buildForest: видимость по категории', () => {
  const root = node({ name: 'Как крепится', required: true });
  const anchor = node({ name: 'Анкерное', parentId: root.id, text: 'Анкерами.', categories: 'TRN,WRK', order: 1 });
  const concrete = node({ name: 'Бетонирование', parentId: root.id, text: 'Бетоном.', allCategories: true, order: 2 });
  const nodes = [root, anchor, concrete];

  it('«Для всех» и свой код; чужая категория видит только «Для всех»', () => {
    expect(buildForest(nodes, 'TRN')[0].children.map((c) => c.name)).toEqual(['Анкерное', 'Бетонирование']);
    expect(buildForest(nodes, 'DIO')[0].children.map((c) => c.name)).toEqual(['Бетонирование']);
  });
  it('лист без текста и тупиковая ветка не показываются; раздел без вариантов — тоже', () => {
    expect(buildForest([root], 'TRN')).toEqual([]);
    expect(buildForest([root, node({ name: 'Ветка', parentId: root.id }), node({ name: 'Пустой', parentId: root.id, allCategories: true })], 'TRN')).toEqual([]);
  });
  it('предок виден, если виден потомок; без категории — всё дерево', () => {
    const branch = node({ name: 'Ветка', parentId: root.id, categories: 'MAF' });
    const leaf = node({ name: 'Лист', parentId: branch.id, text: 'Т.', allCategories: true });
    expect(buildForest([root, branch, leaf], 'WRK')[0].children[0].children[0].name).toBe('Лист');
    expect(buildForest(nodes)[0].children).toHaveLength(2);
  });
  it('старые записи (текст, нет родителя) и сироты разделом не считаются; порядок — по order', () => {
    const legacy = node({ name: 'Старый', text: 'Текст', allCategories: true });
    const orphan = node({ name: 'Сирота', parentId: hex(9999), text: 'Т.', allCategories: true });
    const f = buildForest([legacy, orphan, root, concrete, anchor], 'TRN');
    expect(f).toHaveLength(1);
    expect(f[0].children.map((c) => c.name)).toEqual(['Анкерное', 'Бетонирование']);
    expect(presentForest(f)[0]).toEqual(expect.objectContaining({ section: 'installation', slot: 1, required: true }));
  });
  it('глубина больше 4 в дерево не попадает', () => {
    const a = node({ name: 'a' }), b = node({ name: 'b', parentId: a.id }), c = node({ name: 'c', parentId: b.id }), d = node({ name: 'd', parentId: c.id }), e = node({ name: 'e', parentId: d.id, text: 'Т.', allCategories: true });
    expect(buildForest([a, b, c, d, e], 'TRN')).toEqual([]);
  });
});

describe('resolveChoices: автовыбор единственного', () => {
  const root = node({ name: 'Назначение', section: 'purpose', required: true });
  const one = node({ name: 'Единственный', parentId: root.id, text: 'Текст.', allCategories: true });
  const rootB = node({ name: 'Монтаж', section: 'mounting', required: true });
  const x = node({ name: 'X', parentId: rootB.id, text: 'X.', allCategories: true, order: 1 });
  const y = node({ name: 'Y', parentId: rootB.id, text: 'Y.', allCategories: true, order: 2 });
  const forest = buildForest([root, one, rootB, x, y], 'TRN');

  it('один вариант подставляется сам; из двух — нужен выбор', () => {
    const r = resolveChoices(forest, null);
    expect(r.leaves.get(root.id)?.leaf.id).toBe(one.id);
    expect(r.leaves.get(root.id)?.auto).toBe(true);
    expect(r.leaves.has(rootB.id)).toBe(false);
    expect(missingChoices(r)).toEqual([{ label: 'Выбор: Монтаж', key: `choice:${rootB.id}` }]);
  });
  it('«по умолчанию» подставляется, пока не выбран другой', () => {
    const f = buildForest([rootB, x, { ...y, isDefault: true }], 'TRN');
    expect(resolveChoices(f, null).leaves.get(rootB.id)?.leaf.id).toBe(y.id);
    expect(resolveChoices(f, { [rootB.id]: x.id }).leaves.get(rootB.id)?.leaf.id).toBe(x.id);
  });
  it('выбор, невидимый категории, — недостающий и сам не заменяется', () => {
    const r = resolveChoices(forest, { [rootB.id]: hex(777) });
    expect(r.invalid).toEqual([rootB.id]);
    expect(r.leaves.has(rootB.id)).toBe(false);
  });
  it('выбор подветки спускается до листа (единственный подвариант)', () => {
    const br = node({ name: 'Ветка', parentId: rootB.id, allCategories: true, order: 3 });
    const lf = node({ name: 'Лист', parentId: br.id, text: 'Л.', allCategories: true });
    const f = buildForest([rootB, x, y, br, lf], 'TRN');
    expect(resolveChoices(f, { [rootB.id]: br.id }).leaves.get(rootB.id)?.leaf.id).toBe(lf.id);
  });
  it('обязательность: необязательный раздел без выбора не мешает; ручной текст закрывает', () => {
    const f = buildForest([{ ...rootB, required: false }, x, y], 'TRN');
    expect(missingChoices(resolveChoices(f, null))).toEqual([]);
    expect(missingChoices(resolveChoices(forest, null), (r) => r.section === 'mounting')).toEqual([]);
  });
});

describe('checkNode: проверки при записи', () => {
  const a = node({ name: 'Раздел' }), b = node({ name: 'Вариант', parentId: a.id }), c = node({ name: 'Подвариант', parentId: b.id }), leaf = node({ name: 'Лист', parentId: c.id, text: 'Т.' });
  const all = [a, b, c, leaf];
  it('родитель должен существовать', () => expect(checkNode(all, { parentId: hex(5000), text: '' })).toMatch(/Родитель не найден/));
  it('нельзя вложить в себя или потомка', () => {
    expect(checkNode(all, { id: a.id, parentId: c.id, text: '' })).toMatch(/в самого себя/);
    expect(checkNode(all, { id: b.id, parentId: b.id, text: '' })).toMatch(/в самого себя/);
  });
  it('глубина не больше 4', () => {
    expect(checkNode(all, { parentId: leaf.id, text: 'Т.' })).toMatch(/есть текст/);
    expect(checkNode(all.map((n) => (n.id === leaf.id ? { ...n, text: '' } : n)), { parentId: leaf.id, text: 'Т.' })).toMatch(/Слишком глубоко/);
    expect(checkNode(all, { id: leaf.id, parentId: a.id, text: 'Т.' })).toBeNull();
    expect(depthOf(new Map(all.map((n) => [n.id, n])), leaf.id)).toBe(4);
  });
  it('у узла с вариантами нет текста', () => {
    expect(checkNode(all, { id: b.id, parentId: a.id, text: 'Текст' })).toMatch(/конечном варианте/);
    expect(checkNode(all, { parentId: b.id, text: '' })).toBeNull();
  });
  it('«по умолчанию» — один среди соседей', () => {
    const d = node({ name: 'Д', parentId: a.id, isDefault: true, text: 'Т.' });
    expect(checkNode([a, d], { parentId: a.id, text: 'Т.', isDefault: true })).toMatch(/уже стоит/);
  });
});

describe('выбор из запроса', () => {
  it('parseChoices: пусто → null, мусор → 400, пустое значение снимает выбор', () => {
    expect(parseChoices(undefined)).toBeNull();
    expect(parseChoices({})).toBeNull();
    expect(parseChoices({ [hex(1)]: '' })).toBeNull();
    expect(parseChoices({ [hex(1)]: hex(2) })).toEqual({ [hex(1)]: hex(2) });
    expect(() => parseChoices({ abc: hex(2) })).toThrow(BadRequestException);
    expect(() => parseChoices([1])).toThrow(BadRequestException);
  });
  it('checkChoices: раздел — корень, вариант — лист этого раздела', () => {
    const r1 = node({ name: 'Р1' }), r2 = node({ name: 'Р2' });
    const l1 = node({ name: 'Л1', parentId: r1.id, text: 'Т.' }), l2 = node({ name: 'Л2', parentId: r2.id, text: 'Т.' });
    const nodes = [r1, r2, l1, l2];
    expect(checkChoices(nodes, { [r1.id]: l1.id })).toBeNull();
    expect(checkChoices(nodes, { [r1.id]: l2.id })).toMatch(/другому разделу/);
    expect(checkChoices(nodes, { [r1.id]: r2.id })).toMatch(/не конечный/);
    expect(checkChoices(nodes, { [l1.id]: l1.id })).toMatch(/Раздел текста не найден/);
  });
  it('toNode читает запись справочника', () => {
    const n = toNode({ _id: hex(3), name: ' А ', parentId: hex(2), allCategories: true, order: '2', slot: 0, text: 'Т\nТ' });
    expect(n).toEqual(expect.objectContaining({ id: hex(3), name: 'А', parentId: hex(2), allCategories: true, order: 2, slot: 1, text: 'Т\nТ' }));
  });
});
