import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const code = fs.readFileSync(new URL('./financial-articles-state.js', import.meta.url), 'utf8');
const s = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const tree = [{ id: 'g', name: 'Материалы', nodeKind: 'group', children: [{ id: 'sub', name: 'Основание', nodeKind: 'group', children: [{ id: 'leaf', name: 'Бетон', nodeKind: 'article', categoryIds: ['cat'] }] }, { id: 'old', name: 'Архивная', nodeKind: 'article', archivedAt: '2026-01-01' }] }, { id: 'inc', type: 'income', name: 'Доходы', nodeKind: 'group' }];
test('C159: путь третьего уровня, selectable leaf, архив и сохранённые IDs', () => {
  assert.equal(s.flattenArticles(tree)[2].path.join(' → '), 'Материалы → Основание → Бетон');
  assert.deepEqual(s.articleChoices(tree).map(x => x.value), ['', 'leaf']);
  assert.match(s.articleChoices(tree, '', { savedId: 'old' }).at(-1).label, /архивная/);
  assert.equal(s.articleChoices(tree, '', { savedId: 'missing' }).at(-1).value, 'missing');
});
test('C159: родители исключают себя/потомков/другойtype/архивные; идентичность не зависит от имени', () => {
  assert.deepEqual(s.articleParentChoices(tree, 'g', 'expense').map(x => x.value), ['']);
  assert.deepEqual(s.articleParentChoices(tree, 'leaf', 'expense').map(x => x.value), ['', 'g', 'sub']);
  assert.equal(s.categoryArticleCandidates(tree, 'cat')[0].id, 'leaf');
  const rename = structuredClone(tree); rename[0].name = 'Любое новое имя'; assert.equal(s.articleChoices(rename)[1].value, 'leaf');
});
test('C159: повреждённое дерево/лимит не вызывают бесконечную рекурсию', () => {
  const cycle = { id: 'a', name: 'A' }; cycle.children = [cycle]; assert.throws(() => s.flattenArticles([cycle]), /цикл/);
  let deep = { id: 'last', name: 'last' }; for (let i = 0; i < 34; i++) deep = { id: String(i), name: String(i), children: [deep] };
  assert.throws(() => s.flattenArticles([deep]), /Глубина/);
});
test('C159: writer сохраняет version/revision, group неselectable и categoryIds; без revision записи нет', () => {
  const values = { name: 'Бетон', type: 'expense', nodeKind: 'group', selectable: 'yes', activity: 'active', categoryIds: ['cat'], _financialIdentity: JSON.stringify({ version: 2, expectedTreeRevision: 17 }) };
  const body = s.financialArticleBody(values); assert.equal(body.version, 2); assert.equal(body.expectedTreeRevision, 17); assert.equal(body.selectable, false); assert.deepEqual(body.categoryIds, ['cat']); assert.equal(body.archivedAt, null);
  assert.throws(() => s.financialArticleBody({ ...values, _financialIdentity: {} }), /ревизия/);
});


test('C159: верхний уровень доступен группе, статье нужен явный родитель, без случайного выбора', () => {
  const group = s.articleParentChoices(tree, null, 'expense');
  assert.equal(group[0].value, ''); assert.equal(group[0].label, 'Верхний уровень'); assert.notEqual(group[0].disabled, true);
  const article = s.articleParentChoices(tree, null, 'expense', { nodeKind: 'article' });
  assert.deepEqual(article[0], { value: '', label: 'Выберите родительскую группу', disabled: true });
  const values = { name: 'Лист', type: 'expense', nodeKind: 'article', selectable: 'yes', _financialIdentity: { expectedTreeRevision: 1 } };
  for (const parentId of ['', null, '   ']) assert.throws(() => s.financialArticleBody({ ...values, parentId }), error => error.field === 'parentId');
  assert.equal(s.financialArticleBody({ ...values, parentId: 'sub' }).parentId, 'sub');
  assert.equal(s.financialArticleBody({ ...values, nodeKind: 'group', parentId: '' }).parentId, null);
});


test('C159: invalidHierarchy исключает группу из родителей и лист из новых выборов, сохраняя исторический ID', () => {
  const broken = [{ id: 'bad-group', name: 'Повреждённая группа', nodeKind: 'group', invalidHierarchy: true, children: [{ id: 'bad-leaf', name: 'Сохранённая статья', nodeKind: 'article', selectable: true, invalidHierarchy: true }] }, { id: 'good', name: 'Исправная группа', nodeKind: 'group' }];
  assert.deepEqual(s.articleParentChoices(broken, null, 'expense').map(row => row.value), ['', 'good']);
  assert.equal(s.selectableArticle(s.flattenArticles(broken)[1]), false);
  assert.deepEqual(s.articleChoices(broken).map(row => row.value), ['']);
  const saved = s.articleChoices(broken, '', { savedId: 'bad-leaf' }).at(-1);
  assert.equal(saved.value, 'bad-leaf'); assert.match(saved.label, /сохранённая, не для новых/);
});
