import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { table, link, actions, select, section, pick, clamp } from '../ui/kit/index.js';
import { FINANCIAL_KEYS, flattenArticles, articleParentChoices, financialArticleBody } from './financial-articles-state.js';
import { loadFinancialArticles, resetFinancialArticles } from './financial-articles.js';
export { FINANCIAL_KEYS, financialArticleBody };
let includeArchived = false;
export function financialDictTable(data, { q = '', canEdit, redraw }) {
  const rows = flattenArticles(data.items || []).filter(row => (includeArchived || (!row.archivedAt && !row.ancestorArchived)) && row.path.join(' ').toLocaleLowerCase('ru').includes(q.trim().toLocaleLowerCase('ru')));
  return section({ title: 'Финансовые статьи', open: true, body: [(data.diagnostics || []).length ? section({ title: 'Требуют проверки', open: true, body: data.diagnostics.map(item => h('p', { class: 'hint' }, typeof item === 'string' ? item : item.message || item.reason || 'Нарушена связь статьи; нужна сверка справочника')) }) : null, actions(select({ label: 'Архив статей', value: includeArchived ? 'all' : 'active', options: [{ value: 'active', label: 'Активные' }, { value: 'all', label: 'Включая архивные' }], onChange: value => { includeArchived = value === 'all'; redraw(); } })),
    table({ label: 'Статьи доходов и расходов', columns: [{ label: 'Полный путь', wrap: true }, { label: 'Тип' }, { label: 'Вид' }, { label: 'Выбор' }, { label: 'Состояние' }, { label: 'Связи', num: true }, { label: 'Действие' }],
      rows: rows.map(row => ({ data: row.id, cells: [h('span', null, clamp(h('b', null, row.name), { lines: 2 }), row.path.length > 1 ? clamp(row.path.join(' → '), { lines: 3 }) : null), row.type === 'income' ? 'Поступление' : 'Выплата', row.nodeKind === 'group' ? 'Группа' : 'Статья', row.nodeKind === 'article' && row.selectable !== false ? 'Доступна' : 'Не выбирается', row.invalidHierarchy ? 'Требует сверки' : row.archivedAt || row.ancestorArchived ? 'Архив' : 'Активна', row.usage?.total ?? row.usageCount ?? 'Нужна сверка', canEdit ? link({ label: 'Изменить', onClick: () => patch({ of: 'dict', open: row.id, new: undefined }) }) : 'Только просмотр'] })), empty: { title: 'Статей по этим условиям нет', hint: 'Измените поиск или включите архив.' } }),
  ] });
}
export async function financialDictFields(row, key, info) {
  const data = await loadFinancialArticles({ includeUsage: true, refresh: true });
  const current = flattenArticles(data.items || []).find(item => item.id === String(row?.id));
  const type = row?.type || current?.type || (key === 'incomeArticles' ? 'income' : 'expense');
  const identity = { expectedTreeRevision: data.revision, ...(row?.id ? { version: row.version ?? current?.version } : {}), archivedAt: row?.archivedAt || null };
  if (row?.id && identity.version == null) throw new Error('Версия статьи неизвестна: обновите справочник');
  const syncParent = api => { const sync = () => { const input = api.input('parentId'); const old = input.value; const options = articleParentChoices(data.items, row?.id, api.get('type') || type, { nodeKind: api.get('nodeKind') || row?.nodeKind || current?.nodeKind || 'group' }); input.replaceChildren(...options.map(option => h('option', { value: option.value, disabled: !!option.disabled }, option.label))); input.value = options.some(option => option.value === old) ? old : ''; input.dispatchEvent(new Event('change', { bubbles: true })); }; api.on('type', sync); api.on('nodeKind', sync); sync(); };
  return [
    { section: 'Статья и место в справочнике', fixed: true },
    { note: 'Переименование и перенос меняют подписи отчётов, сохраняя связи с документами и суммы. Для классификации отдельной оплаты используйте «Уточнить для отчёта».' },
    { key: '_financialIdentity', label: '', type: 'hidden', mount: api => api.set('_financialIdentity', JSON.stringify(identity)) },
    { key: 'name', label: 'Название', required: true, max: 300, wide: true },
    { key: 'type', label: 'Направление', type: 'select', options: [{ value: 'expense', label: 'Выплаты' }, { value: 'income', label: 'Поступления' }], mount: api => { api.set('type', type); } },
    { key: 'nodeKind', label: 'Группа или статья', type: 'select', options: [{ value: 'group', label: 'Группа' }, { value: 'article', label: 'Статья' }], mount: api => { if (!row?.nodeKind) api.set('nodeKind', current?.nodeKind || 'group'); } },
    { key: 'parentId', label: 'Родительская группа', type: 'select', wide: true, options: articleParentChoices(data.items, row?.id, type, { nodeKind: row?.nodeKind || current?.nodeKind || 'group' }), mount: syncParent },
    { key: 'selectable', label: 'Предлагать для новых операций', type: 'select', options: [{ value: 'yes', label: 'Да' }, { value: 'no', label: 'Нет' }], mount: api => { api.set('selectable', (row?.selectable ?? current?.selectable) === false ? 'no' : 'yes'); const sync = () => { api.field('selectable').hidden = api.get('nodeKind') === 'group'; }; api.on('nodeKind', sync); sync(); } },
    { key: 'sortOrder', label: 'Порядок', type: 'number' },
    { key: 'activity', label: 'Активность', type: 'select', options: [{ value: 'active', label: 'Активна' }, { value: 'archived', label: 'Архивная — только история' }], hint: 'Группа с активными детьми не архивируется; сервер покажет препятствия.', mount: api => api.set('activity', row?.archivedAt ? 'archived' : 'active') },
    { key: 'categoryIds', label: 'Подсказки складских категорий', type: 'widget', wide: true, mount: api => { const sync = () => { api.field('categoryIds').hidden = api.get('type') !== 'expense' || api.get('nodeKind') !== 'article'; }; api.on('type', sync); api.on('nodeKind', sync); sync(); }, widget: value => pick({ mode: 'tags', label: 'Категории', value: value || [], options: [...(info.refs?.categories || []).map(option => ({ value: String(option.value), label: option.label })), ...(value || []).filter(id => !(info.refs?.categories || []).some(option => String(option.value) === String(id))).map(id => ({ value: String(id), label: 'Сохранённая категория ' + id }))] }) },
    { note: current ? `Текущий путь: ${current.path.join(' → ')}. Связей: ${current.usage?.total ?? current.usageCount ?? 'нужна сверка'}.` : 'После создания запись появится в справочнике; сохранение не создаёт денежной операции.' },
  ];
}
export async function financialDictWrite(key, row, action, body) {
  if (action === 'merge') throw new Error('Объединение финансовых статей недоступно: сохраните историю через перенос или архив');
  let payload = body;
  if (!payload) { const [data, fresh] = await Promise.all([loadFinancialArticles({ refresh: true }), action === 'restore' ? api(`/dicts/${key}/${row.id}`) : Promise.resolve(row)]); payload = { version: fresh.version, expectedTreeRevision: data.revision }; }
  if (payload.expectedTreeRevision == null || (row?.id && payload.version == null)) throw new Error('Версия статьи или ревизия дерева неизвестна: обновите справочник');
  const result = await api(`/dicts/${key}${row?.id ? '/' + row.id : ''}${action === 'restore' ? '/restore' : ''}`, { method: action === 'create' || action === 'restore' ? 'POST' : action === 'remove' ? 'DELETE' : 'PATCH', body: payload });
  resetFinancialArticles(); return result;
}
