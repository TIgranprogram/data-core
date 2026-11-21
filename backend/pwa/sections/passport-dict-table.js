import { h } from '../core/dom.js';
import { table, stack, hint, button, empty, clamp } from '../ui/kit/index.js';
import { whenText } from './passports/traits.js';

const ids = (value) => Array.isArray(value) ? value.map(String) : String(value || '').split(/[,;\s]+/).filter(Boolean);
const labelOf = (row) => String(row?.name || row?.title || '').trim();
const REFERENCES = [['kindIds', 'passportKinds', 'Вид'], ['partIds', 'passportParts', 'Части'],
  ['facetValueIds', 'productFacetValues', 'Признаки'], ['groupIds', 'productGroups', 'Группы'], ['installTypeId', 'passportInstall', 'Способ установки']];
/** Только подписи существующих связей; никакой новой проверки применимости. */
export async function loadPhraseTableReferences(read) {
  return Object.fromEntries(await Promise.all(REFERENCES.map(async ([, dict]) => [dict,
    new Map((await read(dict)).map((row) => [String(row.id || row._id), labelOf(row)]))])));
}
export function conditionLabel(raw) {
  if (!raw) return 'Всегда';
  const shown = whenText(raw);
  if (shown === String(raw) && /^[A-Za-z\d_.!&|()\s-]+$/.test(shown)) return 'Особое условие — откройте пункт';
  return String(shown).replace(/[a-f\d]{24}/gi, 'недоступная связь');
}
function chainOf(model, node) {
  const out = [], seen = new Set();
  for (let current = node; current && !seen.has(current.id); current = model.byId.get(current.parentId)) {
    seen.add(current.id); out.unshift(current);
  }
  return out;
}
function referenceText(chain, references) {
  return chain.flatMap((node, index) => REFERENCES.flatMap(([field, dict, title]) => {
    const values = ids(node[field]);
    if (!values.length) return [];
    const names = values.map((id) => references[dict]?.get(id) || 'связь недоступна');
    return [`${title}: ${names.join(', ')}${index < chain.length - 1 ? ` (от «${node.name || 'родитель'}»)` : ''}`];
  }));
}
export function phraseTableRows({ model, roots, shown, references = {}, catText }) {
  const rows = [];
  const visit = (node) => {
    const children = model.children(node.id).filter(shown);
    const chain = chainOf(model, node);
    rows.push({ id: node.id, node, parent: chain.length > 1 ? labelOf(chain.at(-2)) : '—',
      path: chain.slice(0, -1).map(labelOf).join(' › ') || 'Раздел',
      title: labelOf(node) || 'Без названия', text: String(node.text || ''),
      type: chain.map((item, index) => `${catText(item)}${index < chain.length - 1 ? ` (от «${item.name || 'родитель'}»)` : ''}`).filter((value, i, all) => all.indexOf(value) === i).join('; '),
      links: referenceText(chain, references), root: !node.parentId, branch: !!model.children(node.id).length,
      badges: [node.isDefault ? 'По умолчанию' : '', node.required ? 'Обязательный раздел' : ''].filter(Boolean) });
    children.forEach(visit);
  };
  roots.forEach(visit);
  return rows;
}
export function filterDictionaryRows(rows, query) {
  const q = String(query || '').trim().toLocaleLowerCase('ru');
  if (!q) return rows;
  const matches = (row) => [row.path, row.parent, row.title, row.text, row.type, row.origin, row.replaces, row.condition, ...(row.links || []), ...(row.badges || [])].join(' ').toLocaleLowerCase('ru').includes(q);
  return rows.filter(matches);
}
export function phraseDictionaryTable({ model, roots, shown, references, catText, selected, edit, open, add, quality, renderText, query, reset, gap }) {
  const rows = filterDictionaryRows(phraseTableRows({ model, roots, shown, references, catText }), query);
  if (!rows.length) return empty({ kind: 'notFound', query, onReset: reset, hint: 'Измените поиск или фильтр типа и качества.' });
  return table({ label: 'Тексты паспорта: разделы, варианты и связи', clickable: true,
    columns: [{ label: 'Раздел / родитель', wrap: true }, { label: 'Вариант', wrap: true }, { label: 'Текст', wrap: true }, { label: 'Тип паспорта', wrap: true }, { label: 'Связи / применимость', wrap: true }],
    rows: rows.map((row) => ({ data: row.id, selected: row.id === selected, onClick: () => open(row.id), cells: [
      stack(clamp(row.path), row.parent !== '—' ? hint('Родитель: ' + row.parent) : null),
      stack(h(row.root ? 'strong' : 'span', null, row.title), row.branch ? hint(row.root ? 'Раздел' : 'Группа вариантов') : null,
        ...row.badges.map((text) => hint(text)), ...quality(row.node), gap?.(row.node) ? hint('Нет текста для выбранного типа', 'warn') : null,
        row.branch && edit ? button({ label: '+ Вариант', kind: 'ghost', size: 'S', onClick: (e) => { e.stopPropagation(); add(row.id); } }) : null),
      row.text ? clamp(h('span', null, ...renderText(row.text))) : hint(row.branch ? 'Текст в дочерних вариантах' : 'Пустой текст'),
      clamp(row.type || 'Тип не указан'), row.links.length ? stack(...row.links.map((text) => hint(clamp(text)))) : hint('Без дополнительных связей'),
    ] })) });
}
export function generalTextTableRows(cat, text, conditionFor) {
  return text.tree.flatMap((section) => {
    const mine = section.ownSection != null;
    const origin = cat === 'ALL' ? 'Для всех' : section.allSection == null ? 'Раздел категории' : mine ? 'Общий + категория' : 'Общий раздел';
    return [{ section: true, id: 'section.' + section.key, number: String(section.number), title: section.title,
      path: section.title, parent: '—', text: '', origin, replaces: '', condition: '—', node: section },
    ...section.items.map((item) => ({ id: item.origin === 'all' ? `${cat}.a.${section.key}.${item.allIndex}` : `${cat}.i.${section.ownSection}.${item.ownIndex}`,
      of: item.origin === 'all' ? 'ptextview' : 'ptext', number: item.number || '—', title: 'Пункт ' + (item.number || 'без номера'),
      path: section.title, parent: section.title, text: item.text || '', item,
      origin: item.origin === 'all' ? 'Для всех · просмотр' : item.origin === 'override' ? 'Категория · замена общего' : cat === 'ALL' ? 'Для всех' : 'Категория · дополнение',
      replaces: item.origin === 'override' ? 'Заменяет общий пункт ' + (item.number || '') : item.origin === 'all' ? 'Базовый общий пункт' : 'Добавляет пункт',
      condition: conditionLabel(conditionFor(section, item)), node: section,
    }))];
  });
}
export function generalTextsTable({ cat, text, selected, edit, open, add, renderText, conditionFor, query, reset }) {
  const rows = filterDictionaryRows(generalTextTableRows(cat, text, conditionFor), query);
  if (!rows.length) return empty({ kind: 'notFound', query, onReset: reset, hint: 'Измените поиск или тип паспорта.' });
  return table({ label: 'Общие разделы паспорта: источник и замены', clickable: true,
    columns: [{ label: 'Номер', nowrap: true }, { label: 'Раздел / пункт', wrap: true }, { label: 'Текст', wrap: true }, { label: 'Источник', wrap: true }, { label: 'Заменяет / когда', wrap: true }],
    rows: rows.map((row) => ({ data: row.id, selected: !row.section && row.id === selected, onClick: row.section ? undefined : () => open(row.of, row.id), cells: [
      row.number, row.section ? stack(h('strong', null, row.title), edit && row.node.ownSection != null ? button({ label: '+ Пункт', kind: 'ghost', size: 'S', onClick: () => add(row.node) }) : null)
        : stack(row.title, hint('Родитель: ' + row.parent)),
      row.section ? hint('Раздел') : clamp(h('span', null, ...renderText(row.item.bullet ? row.text : row.text.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, '')))),
      row.origin, row.section ? '—' : stack(row.replaces, hint('Когда: ' + row.condition)),
    ] })) });
}
