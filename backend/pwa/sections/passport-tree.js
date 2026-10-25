import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { busyBlock, failBlock } from '../ui/busy.js';
import { current, patch } from '../core/router.js';
import { confirmDlg, modal } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { catChips } from '../ui/cat-chips.js';
import { dupeCounts, qualityBadges, qualityFilter } from '../ui/quality.js';
import { LATER_CATS, dictRows } from './passports/common.js';
import { VARS, canEditTexts } from './passport-texts.js';

/**
 * «Справочники → Паспорта → Тексты паспорта» (ПВ, 2026-10-25): слева дерево «раздел → вариант → подвариант» с метками «пусто» / «дубль · N»
 * и фильтром «Все / Пустые / Дубли»; справа (панель, DESIGN §5) — вариант: текст, категории галочками («Для всех» первым), порядок,
 * «по умолчанию», «Объединить с…», «Убрать». Данные — dict_values passportPhrases (узел: parentId, text, categories, allCategories, order, required, isDefault).
 * Адрес: #dicts?d=passportPhrases; панель — of=ptnode&open=<id узла> | new.<id родителя>.
 */
export const TREE_KEY = 'passportPhrases';
const DICT = '/dicts/' + TREE_KEY;

// ─── данные ──────────────────────────────────────────────────────────────────────────────────────
let cache = null; // { items, cats }
export async function loadTree(force) {
  if (!force && cache) return cache;
  const [res, cats] = await Promise.all([api(DICT), dictRows('passportCategories')]);
  cache = { items: (res.items || []).map(norm), cats: cats.filter((c) => c.code && c.code !== 'ALL').map((c) => ({ code: String(c.code), name: c.name })) };
  return cache;
}
const norm = (n) => ({ ...n, id: String(n.id), parentId: n.parentId ? String(n.parentId) : '', text: String(n.text || ''), order: Number(n.order) || 0,
  allCategories: n.allCategories === undefined ? !String(n.categories || '').trim() : !!n.allCategories });
const forget = () => { cache = null; };
const refresh = () => { forget(); window.dispatchEvent(new CustomEvent('data-changed')); };

/** Дерево из плоского списка: children(id), корни, путь, метки качества. */
function shape(items) {
  const kids = new Map();
  for (const n of items) { const k = n.parentId; (kids.get(k) || kids.set(k, []).get(k)).push(n); }
  for (const list of kids.values()) list.sort((a, b) => a.order - b.order || String(a.name).localeCompare(String(b.name), 'ru'));
  const byId = new Map(items.map((n) => [n.id, n]));
  const children = (id) => kids.get(id) || [];
  const roots = children('');
  const leavesOf = (id) => (children(id).length ? children(id).flatMap((c) => leavesOf(c.id)) : [byId.get(id)]).filter(Boolean);
  const rootOf = (n) => { let x = n; while (x.parentId && byId.get(x.parentId)) x = byId.get(x.parentId); return x; };
  const path = (n) => { const out = []; let x = n; while (x) { out.unshift(x.name); x = x.parentId ? byId.get(x.parentId) : null; } return out; };
  // дубль — одинаковый текст у вариантов одного раздела
  const dupes = new Map();
  for (const r of roots) for (const [id, n] of dupeCounts(leavesOf(r.id).filter((l) => l.id !== r.id), (l) => l.text)) dupes.set(id, n);
  const isEmpty = (n) => !children(n.id).length && n.parentId && !n.text.trim();
  return { byId, children, roots, leavesOf, rootOf, path, dupes, isEmpty };
}

// ─── экран ───────────────────────────────────────────────────────────────────────────────────────
export function mountTree() {
  const edit = canEditTexts();
  let mode = 'all'; let model = null; let catsMap = new Map();
  const info = h('p', { class: 'hint pt-info' });
  const filterBox = h('div');
  const tree = h('div', { class: 'pt-tree' }, busyBlock('тексты'));
  const el = h('div', { class: 'pt' }, h('div', { class: 'pt-bar' }, info, filterBox),
    edit ? null : h('p', { class: 'hint' }, 'Смотреть могут все; править тексты — директор и администратор.'), tree);
  const catText = (n) => (n.allCategories ? 'для всех' : String(n.categories || '').split(/[,;\s]+/).filter(Boolean).map((c) => catsMap.get(c) || c).join(', '));

  function render() {
    if (!model) return;
    const sel = current().params.open || '';
    const empties = model.roots.flatMap((r) => model.leavesOf(r.id)).filter((l) => model.isEmpty(l)).length;
    info.textContent = 'Нажмите на вариант — правка откроется справа. Пустые и повторяющиеся тексты помечены: объедините дубли, впишите пустое.';
    filterBox.replaceChildren(qualityFilter({ value: mode, counts: { empty: empties, dupes: model.dupes.size }, onChange: (v) => { mode = v; render(); } }));
    const shown = (n) => {
      if (mode === 'all') return true;
      const kids = model.children(n.id);
      if (kids.length) return kids.some(shown);
      return mode === 'empty' ? model.isEmpty(n) : model.dupes.has(n.id);
    };
    const row = (n, depth) => {
      const kids = model.children(n.id).filter(shown);
      const leaf = !model.children(n.id).length;
      const btn = h('button', { type: 'button', class: 'pt-item' + (sel === n.id ? ' active' : ''), 'data-depth': String(depth), onclick: () => patch({ of: 'ptnode', open: n.id, new: undefined }) },
        h('span', { class: 'pt-name' }, n.name || 'Без названия'),
        leaf && n.text.trim() ? h('span', { class: 'pt-text' }, n.text.replace(/\{[^}]+\}/g, '…')) : null,
        ...qualityBadges({ empty: model.isEmpty(n), dupe: model.dupes.get(n.id) || 0 }),
        leaf ? h('span', { class: 'pt-cats' }, catText(n)) : null,
        n.isDefault ? h('span', { class: 'pt-tag own' }, 'по умолчанию') : null);
      return [h('li', null, btn), ...kids.flatMap((k) => row(k, depth + 1))];
    };
    const secs = model.roots.filter(shown);
    if (!secs.length) { tree.replaceChildren(h('div', { class: 'state' }, mode === 'all' ? 'Разделов пока нет — их создаёт программа при обновлении справочника.' : mode === 'empty' ? 'Пустых текстов нет.' : 'Дублей нет.')); return; }
    tree.replaceChildren(...secs.map((r) => h('section', { class: 'pt-sec' },
      h('div', { class: 'pt-sec-head' }, h('h3', null, r.name), r.required ? h('span', { class: 'pt-sec-tag' }, 'обязательный раздел') : null,
        edit ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => patch({ of: 'ptnode', open: 'new.' + r.id, new: undefined }) }, '+ Вариант') : null),
      model.children(r.id).length ? h('ul', { class: 'pt-items' }, ...model.children(r.id).filter(shown).flatMap((k) => row(k, 0))) : h('p', { class: 'muted' }, 'Вариантов пока нет — «+ Вариант».'))));
  }
  async function reload() {
    if (!model) tree.replaceChildren(busyBlock('тексты', { retry: () => reload() }));
    try { const d = await loadTree(true); catsMap = new Map(d.cats.map((c) => [c.code, c.name])); model = shape(d.items); render(); }
    catch (e) { tree.replaceChildren(failBlock(e, () => reload())); }
  }
  return { el, reload, update: () => render() };
}

// ─── правая панель ───────────────────────────────────────────────────────────────────────────────
async function getNode(id) {
  const d = await loadTree();
  const m = shape(d.items);
  if (String(id).startsWith('new.')) {
    const parent = m.byId.get(String(id).slice(4));
    if (!parent) throw new Error('Раздел не найден — список обновился. Закройте панель и выберите заново.');
    return { id, kind: 'new', parentId: parent.id, rootName: m.rootOf(parent).name, pathText: m.path(parent).join(' › '), cats: d.cats, text: '', name: '', allCategories: true, categories: '', order: (m.children(parent.id).at(-1)?.order || 0) + 1 };
  }
  const full = await api(`${DICT}/${id}`);
  const n = norm(full);
  if (!m.byId.has(n.id)) m.byId.set(n.id, n);
  return { ...full, ...n, kind: 'node', cats: d.cats, hasChildren: m.children(n.id).length > 0, isRoot: !n.parentId, pathText: m.path(n).slice(0, -1).join(' › '), rootName: m.rootOf(n).name,
    siblings: m.leavesOf(m.rootOf(n).id).filter((l) => l.id !== n.id && l.parentId).map((l) => ({ id: l.id, name: l.name, text: l.text })) };
}

function nodeForm(r) {
  const isRoot = r.kind === 'node' && r.isRoot;
  const leaf = !isRoot && !r.hasChildren;
  const name = h('input', { type: 'text', maxlength: 200, value: r.name || '', placeholder: isRoot ? '' : 'Например: Анкерное крепление' });
  const ta = h('textarea', { rows: 9, maxlength: 4000, class: 'pt-ta' }); ta.value = r.text || '';
  const order = h('input', { type: 'text', inputmode: 'numeric', maxlength: 4, value: r.order ? String(r.order) : '' });
  const def = h('input', { type: 'checkbox', checked: !!r.isDefault });
  const req = h('input', { type: 'checkbox', checked: !!r.required });
  const chips = !isRoot ? catChips({ options: r.cats, value: r.categories || '', all: r.allCategories, label: 'К каким категориям подходит текст', later: LATER_CATS }) : null;
  const err = h('div', { class: 'err', hidden: true });
  const insert = (v) => { const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s; ta.value = ta.value.slice(0, s) + v + ta.value.slice(e); ta.focus(); ta.selectionStart = ta.selectionEnd = s + v.length; };
  const vars = h('div', { class: 'pt-vars' }, ...VARS.map((v) => h('button', { type: 'button', class: 'tag', onclick: () => insert(v) }, v === '{std:' ? '{std:КОД}' : v)));
  const tools = [];
  if (r.kind === 'node' && !isRoot && !r.hasChildren) tools.push(h('button', { type: 'button', class: 'btn btn-sm', onclick: () => mergeInto(r) }, 'Объединить с…'));
  if (r.kind === 'node' && !isRoot) tools.push(h('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: () => removeNode(r) }, 'Убрать'));
  if (r.kind === 'node' && !isRoot && (r.hasChildren || !r.text.trim()) && r.pathText.split(' › ').length < 3) tools.push(h('button', { type: 'button', class: 'btn btn-sm', onclick: () => patch({ of: 'ptnode', open: 'new.' + r.id }) }, '+ Подвариант'));
  const where = r.kind === 'new' ? `Новый вариант в разделе «${r.pathText}».` : isRoot ? 'Раздел паспорта: здесь его название, порядок и обязательность; варианты — ниже в дереве.' : `${r.pathText}${r.used ? ` · используется: ${r.used}` : ''}`;
  const el = h('div', { class: 'form-grid pt-form' },
    h('p', { class: 'hint wide' }, where, ' Выданные паспорта не меняются; черновики подхватят новый текст при открытии.'),
    h('label', { class: 'field wide' }, h('span', null, isRoot ? 'Название раздела' : 'Название варианта', h('span', { class: 'req' }, ' *')), name),
    leaf ? h('label', { class: 'field wide' }, h('span', null, 'Текст'), ta, err) : null,
    leaf ? h('details', { class: 'month-group wide' }, h('summary', null, `Переменные (${VARS.length}) — клик вставляет в текст`), vars, h('div', { class: 'hint' }, 'Пустая переменная в паспорте видна как «[{имя} не заполнено]».')) : null,
    chips ? h('div', { class: 'field wide' }, h('span', null, 'К каким категориям', h('span', { class: 'req' }, ' *')), chips.el, h('div', { class: 'hint' }, '«Для всех» — подходит любой категории; иначе отметьте нужные.')) : null,
    h('label', { class: 'field span-1' }, h('span', null, 'Порядок'), order),
    !isRoot ? h('label', { class: 'pt-check span-2' }, def, ' По умолчанию (подставляется, пока не выбран другой)') : null,
    isRoot ? h('label', { class: 'pt-check span-2' }, req, ' Обязательный раздел (без выбора паспорт не выпустить)') : null,
    tools.length ? h('div', { class: 'wide actions' }, ...tools) : null);
  const values = () => ({ name: name.value.trim(), ...(leaf ? { text: ta.value.trim() } : {}), ...(chips ? { categories: chips.value, allCategories: chips.all } : {}),
    ...(order.value.trim() ? { order: Number(order.value.replace(',', '.')) || 0 } : {}), ...(isRoot ? { required: req.checked } : { isDefault: def.checked }) });
  const start = JSON.stringify(values());
  let removed = false; r.onRemoved = () => { removed = true; };
  return {
    el,
    focus: () => (leaf ? ta : name).focus(),
    dirty: () => !removed && JSON.stringify(values()) !== start,
    read: () => {
      err.hidden = true;
      if (!name.value.trim()) { name.focus(); toast('Впишите название', { error: true }); return { errors: { name: 1 } }; }
      if (chips?.empty) { chips.focus(); toast('Отметьте категории или «Для всех»', { error: true }); return { errors: { categories: 1 } }; }
      return { values: values() };
    },
  };
}

async function saveNode(id, body) {
  let saved;
  if (String(id).startsWith('new.')) saved = await api(DICT, { method: 'POST', body: { ...body, parentId: String(id).slice(4) } });
  else saved = await api(`${DICT}/${id}`, { method: 'PATCH', body });
  refresh();
  const sid = String(saved?.id || id);
  if (sid !== String(id)) setTimeout(() => patch({ of: 'ptnode', open: sid }), 0);
  return getNode(sid);
}

async function mergeInto(r) {
  if (!r.siblings.length) { toast('В разделе нет других вариантов', { error: true }); return; }
  const sel = h('select', null, h('option', { value: '' }, '— выберите —'), ...r.siblings.map((x) => h('option', { value: x.id }, ((s) => (s.length > 30 ? s.slice(0, 29) + '…' : s))(x.name + (x.text ? ' — ' + x.text : '')))));
  const done = await modal({ title: `Объединить «${r.name}»`, okText: 'Объединить',
    body: h('div', { class: 'pt-merge' }, h('p', { class: 'hint' }, 'Это тот же вариант другими словами? Выбранный останется, «' + r.name + '» уйдёт в корзину, а где он выбран — переключится на выбранный.'), h('label', { class: 'field' }, h('span', null, 'Оставить'), sel)),
    onOk: async () => { if (!sel.value) throw new Error('Выберите, с чем объединить'); return api(`${DICT}/${r.id}/merge`, { method: 'POST', body: { intoId: sel.value } }); } });
  if (done) { r.onRemoved?.(); refresh(); toast('Объединено'); patch({ of: 'ptnode', open: String(done.id || sel.value) }); }
}

async function removeNode(r) {
  if (!(await confirmDlg('Убрать вариант?', `«${r.name}» уйдёт в корзину; из паспортов, где он выбран, пропадёт. Выданные паспорта не меняются.`, { okText: 'Убрать', danger: true }))) return;
  try {
    await api(`${DICT}/${r.id}`, { method: 'DELETE' });
    r.onRemoved?.(); patch({ of: undefined, open: undefined }); refresh();
    toast('Вариант убран', { undo: async () => { try { await api(`${DICT}/${r.id}/restore`, { method: 'POST' }); refresh(); toast('Вариант возвращён'); } catch (e) { toastError(e); } } });
  } catch (e) { toastError(e); }
}

export const ptnode = {
  id: 'ptnode',
  title: 'Тексты паспорта',
  canEdit: canEditTexts,
  get: (id) => getNode(id),
  card: {
    heading: (r) => (r.kind === 'new' ? 'Новый вариант' : r.name),
    subheading: (r) => r.pathText || r.rootName || '',
    startEdit: () => true,
    noHistory: true,
    view: (r) => [['Текст', r.text ? h('span', { class: 'pt-plain' }, r.text) : h('span', { class: 'muted' }, 'пусто — «Изменить»')],
      ['Категории', r.allCategories ? 'Для всех' : String(r.categories || '').split(/[,;\s]+/).filter(Boolean).join(', ')], ['Порядок', r.order || null], ['По умолчанию', r.isDefault ? 'да' : null], ['Используется', r.used || null]],
  },
  form: { build: (r) => nodeForm(r), toInitial: (r) => r, toBody: (v) => v, update: (id, b) => saveNode(id, b), create: (b) => saveNode('new.' + (b.parentId || ''), b) },
};
