import { articleOfCategory, buildFinancialTree, buildTree, flattenFinancialTree, assertSelectableArticle, PAYROLL_CODE, seedDocs } from './articles-tree';
const docs = () => [{ _id: 'a', name: 'Материалы', nodeKind: 'group' as const }, { _id: 'b', name: 'Площадка', parentId: 'a', nodeKind: 'group' as const }, { _id: 'c', name: 'Бетон', parentId: 'b', categoryIds: ['cat'] }];
describe('C161: стабильное рекурсивное дерево', () => {
  it('третья ступень есть в canonical и legacy проекции с тем же ID', () => {
    const canonical = buildFinancialTree(docs());
    expect(flattenFinancialTree(canonical.items).map(n => n.id)).toEqual(['a', 'b', 'c']);
    expect(canonical.items[0].children[0].children[0].path).toEqual(['Материалы', 'Площадка', 'Бетон']);
    expect(buildTree(docs())[0].children.find(n => n.id === 'c')).toMatchObject({ id: 'c', name: 'Площадка → Бетон', parentId: 'b' });
  });
  it('разделяетincome/expense, архивные ветки и отсутствующего родителя', () => {
    const rows = [...docs(), { _id: 'i', name: 'Поступления', type: 'income' as const }, { _id: 'x', name: 'Сирота', parentId: 'missing' }];
    expect(buildFinancialTree(rows).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'x' })]));
    expect(buildTree(rows).map(n => n.id)).toEqual(['a', 'x']);
    expect(buildTree(rows).find(n => n.id === 'x')).toMatchObject({ selectable: false, invalidHierarchy: true });
    expect(buildFinancialTree([{ ...rows[0], archivedAt: new Date() }, ...rows.slice(1)]).items.some(n => n.id === 'a')).toBe(false);
    expect(() => assertSelectableArticle(rows, 'c', 'income')).toThrow();
  });
  it('цикл диагностируется без зацикливания, из него нельзя выбрать новую статью', () => {
    const rows = [{ _id: 'a', name: 'A', parentId: 'b' }, { _id: 'b', name: 'B', parentId: 'a' }];
    expect(buildFinancialTree(rows).diagnostics).toHaveLength(2);
    expect(flattenFinancialTree(buildFinancialTree(rows).items)).toHaveLength(2);
    expect(() => assertSelectableArticle(rows, 'a', 'expense')).toThrow();
  });
  it('неоднозначная categoryId не выбирает случайную статью', () => {
    const tree = buildTree([...docs(), { _id: 'd', name: 'Другой бетон', parentId: 'a', categoryIds: ['cat'] }]);
    expect(articleOfCategory(tree, 'cat')).toBeNull();
    expect(articleOfCategory(buildTree(docs()), 'cat')?.id).toBe('c');
  });
  it('архив/невыбираемый лист/группа не годятся для новой классификации', () => {
    for (const extra of [{ archivedAt: new Date() }, { selectable: false }, { nodeKind: 'group' as const }]) {
      expect(() => assertSelectableArticle(docs().map(d => d._id === 'c' ? { ...d, ...extra } : d), 'c', 'expense')).toThrow();
    }
  });
  it('начальный набор сохраняет14групп и единственныймашинный payrollcode', () => {
    let n = 0; const rows = seedDocs(new Date(), () => 'id' + ++n);
    expect(rows.filter(r => !r.parentId)).toHaveLength(14);
    expect(rows.filter(r => r.code === PAYROLL_CODE)).toHaveLength(1);
    expect(rows.find(r => r.code === 'payroll-group')).toBeTruthy();
  });
  it.each([
    [{ _id: 'r', name: 'R', nodeKind: 'group' as const }, { _id: 'a', name: 'A', parentId: 'r', nodeKind: 'article' as const }, { _id: 'b', name: 'B', parentId: 'a', nodeKind: 'article' as const, categoryIds: ['cat'] }],
    [{ _id: 'a', name: 'A', parentId: 'missing', nodeKind: 'group' as const }, { _id: 'b', name: 'B', parentId: 'a', nodeKind: 'article' as const, categoryIds: ['cat'] }],
    [{ _id: 'a', name: 'A', parentId: 'x', nodeKind: 'group' as const }, { _id: 'x', name: 'X', parentId: 'a', nodeKind: 'group' as const }, { _id: 'b', name: 'B', parentId: 'a', nodeKind: 'article' as const, categoryIds: ['cat'] }],
    [{ _id: 'a', name: 'A', nodeKind: 'article' as const }, { _id: 'b', name: 'B', parentId: 'a', nodeKind: 'article' as const, categoryIds: ['cat'] }],
  ])('потомок повреждённой ветки не становится новым допустимым корнем %#', (...rows) => {
    const graph = buildFinancialTree(rows), flat = flattenFinancialTree(graph.items);
    expect(flat).toHaveLength(rows.length);
    expect(flat.find(n => n.id === 'b')).toMatchObject({ invalidHierarchy: true, selectable: false });
    expect(graph.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'b' })]));
    expect(() => assertSelectableArticle(rows, 'b', 'expense')).toThrow();
    expect(articleOfCategory(buildTree(rows), 'cat')).toBeNull();
  });
  it('явный rootarticle диагностируется и не годится для новой ссылки', () => {
    const rows = [{ _id: 'a', name: 'A', nodeKind: 'article' as const, selectable: true, categoryIds: ['cat'] }];
    expect(buildFinancialTree(rows).diagnostics).toHaveLength(1);
    expect(() => assertSelectableArticle(rows, 'a', 'expense')).toThrow();
    expect(buildTree(rows)[0]).toMatchObject({ id: 'a', selectable: false, invalidHierarchy: true });
  });
  it('бывший лист с историей остаётся в legacylookup как group, categoryhint выбирает только нынешний leaf', () => {
    const rows = docs().map(d => d._id === 'b' ? { ...d, categoryIds: ['cat'] } : d), tree = buildTree(rows);
    expect(tree[0].children.find(n => n.id === 'b')).toMatchObject({ nodeKind: 'group', selectable: false, categoryIds: ['cat'], parentId: 'a', path: ['Материалы', 'Площадка'] });
    expect(articleOfCategory(tree, 'cat')?.id).toBe('c');
  });
  it.each(['b','c'])('архивные ID и потомки остаются для истории, но не становятся hint (%s)', id => {
    const rows = docs().map(d => d._id === id ? { ...d, archivedAt: new Date() } : d), tree = buildTree(rows);
    expect(tree[0].children.map(n => n.id)).toEqual(['b','c']);
    expect(tree[0].children.find(n => n.id === 'c')?.selectable).toBe(false);
    expect(articleOfCategory(tree, 'cat')).toBeNull();
    expect(() => assertSelectableArticle(rows, 'c', 'expense')).toThrow();
  });

});
