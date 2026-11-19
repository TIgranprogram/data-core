/** C161: рекурсивные статьи — только ID и поля контракта, без условий по именам. */
export const FINANCIAL_KEYS = new Set(['financialArticles', 'expenseArticles', 'incomeArticles']);
export function flattenArticles(tree) {
  const output = [], seen = new Set();
  const walk = (nodes, parents = []) => {
    for (const node of nodes || []) {
      if (parents.length >= 32) throw new Error('Глубина статей превышает32 уровня: нужна проверка справочника');
      const id = String(node.id || node._id || '');
      if (!id || seen.has(id)) throw new Error('Повтор или цикл статьи: нужна проверка справочника');
      if (seen.size >= 10000) throw new Error('Справочник превышает10000 узлов');
      seen.add(id);
      const row = { ...node, id, type: node.type || 'expense', nodeKind: node.nodeKind || ((node.children || []).length || !parents.length ? 'group' : 'article'), parentId: node.parentId == null ? parents.at(-1)?.id || null : String(node.parentId), path: [...parents.map(x => x.name), node.name], ancestorIds: parents.map(x => x.id), ancestorArchived: parents.some(x => x.archivedAt) };
      output.push(row); walk(node.children, [...parents, row]);
    }
  };
  walk(tree); return output;
}
export const selectableArticle = row => row.nodeKind === 'article' && !(row.children || []).length && row.selectable !== false && !row.invalidHierarchy && !row.archivedAt && !row.ancestorArchived;
export function articleChoices(tree, empty = 'Не указана', { type = 'expense', savedId } = {}) {
  const rows = flattenArticles(tree).filter(row => row.type === type);
  const options = rows.filter(selectableArticle).map(row => ({ value: row.id, label: row.path.join(' → ') }));
  const saved = rows.find(row => row.id === String(savedId));
  if (savedId && !options.some(row => row.value === String(savedId))) options.push({ value: String(savedId), label: saved ? `${saved.path.join(' → ')} · ${saved.archivedAt || saved.ancestorArchived ? 'архивная' : 'сохранённая, не для новых'}` : 'Сохранённая статья · нужна сверка' });
  return [{ value: '', label: empty }, ...options];
}
export function articleParentChoices(tree, current, type, { nodeKind = 'group' } = {}) {
  const root = nodeKind === 'article' ? { value: '', label: 'Выберите родительскую группу', disabled: true } : { value: '', label: 'Верхний уровень' };
  return [root, ...flattenArticles(tree).filter(row => row.type === type && row.nodeKind === 'group' && !row.invalidHierarchy && !row.archivedAt && !row.ancestorArchived && row.id !== String(current) && !row.ancestorIds.includes(String(current))).map(row => ({ value: row.id, label: row.path.join(' → ') }))];
}
export function categoryArticleCandidates(tree, categoryId) {
  return flattenArticles(tree).filter(row => row.type === 'expense' && selectableArticle(row) && (row.categoryIds || []).map(String).includes(String(categoryId)));
}
export function financialArticleBody(values) {
  const name = String(values.name || '').trim(); if (!name) throw new Error('Укажите название');
  if (!['income', 'expense'].includes(values.type)) throw new Error('Выберите тип статьи');
  if (!['group', 'article'].includes(values.nodeKind)) throw new Error('Выберите группу или статью');
  const parentId = String(values.parentId || '').trim();
  if (values.nodeKind === 'article' && !parentId) throw Object.assign(new Error('Выберите родительскую группу: статья не может находиться на верхнем уровне'), { field: 'parentId' });
  const identity = typeof values._financialIdentity === 'string' ? JSON.parse(values._financialIdentity) : values._financialIdentity;
  if (!identity || identity.expectedTreeRevision == null) throw new Error('Обновите справочник: ревизия дерева неизвестна');
  const body = { name, type: values.type, parentId: parentId || null, nodeKind: values.nodeKind, selectable: values.nodeKind === 'article' && values.selectable === 'yes', sortOrder: Number(values.sortOrder || 0), archivedAt: values.activity === 'archived' ? identity.archivedAt || new Date().toISOString() : null, expectedTreeRevision: identity.expectedTreeRevision };
  if (!Number.isFinite(body.sortOrder)) throw new Error('Проверьте порядок');
  if (identity.version != null) body.version = identity.version;
  if (Array.isArray(values.categoryIds)) body.categoryIds = values.categoryIds;
  return body;
}
