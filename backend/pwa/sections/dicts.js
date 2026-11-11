import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { busyBlock, busyBtn, failBlock } from '../ui/kit/busy.js';
import { money, qty } from '../core/format.js';
import { current, go, patch } from '../core/router.js';
import { confirmDlg, modal } from '../ui/kit/dialog.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { lookups } from './lookups.js';
import { KINDS, KINDS_V2, kindName } from '../core/passport-kinds.js';
import { searchBox, tagPick, button, select, enhanceSelect, navList, layout, toolbar, row, stack, section, actions, badge, empty, hint as hintKit, photoStrip as kitPhotoStrip } from '../ui/kit/index.js';
import { mountTexts, TEXTS_KEY } from './passport-texts.js';
import { mountTree, TREE_KEY } from './passport-tree.js';
import { mountZones, ZONES_KEY } from './stock-zones.js';
import { catChipsField, refChipsField } from '../ui/cat-chips.js';
import { dupeCounts, qualityBadges, qualityFilter } from '../ui/quality.js';
import { passportCategoryOptions } from './passports/common.js';
import { dictSearchTokens, dictHaystack } from './dicts-search.js';
import { sortProductGroups, productGroupTitle, productGroupMeta, productGroupSortBtns } from './dicts-sort.js';

/**
 * «Справочники» (TASKS СП.4–СП.8, DESIGN §4 «Справочники»): слева группы (на телефоне — один select), справа
 * список «название · описание · Изменить · Удалить». «Изменить» — правая панель (of=dict&open=<id>): где используется,
 * предупреждение при смене названия, «Объединить с…». «Удалить»: свободное — подтверждение; занятое — замена на другое
 * значение (только админ). Встроенные значения — замок. Все выпадающие списки приложения берутся отсюда.
 * Адрес: #dicts?d=<справочник>; карточка — of=dict&open=<id> (справочник — из d).
 * d=ptexts — не справочник, а редактор «Паспорта → Общие разделы (шаблон)» (sections/passport-texts.js);
 * d=passportPhrases — дерево «раздел → вариант» «Тексты паспорта» (sections/passport-tree.js).
 */
const dictKey = () => current().params.d || 'categories';
/** Сотрудник: виды работ словами (их может быть несколько: workTypeIds). */
const workTypesText = (r) => { const all = r.dictInfo?.refs?.worktypes || []; const ids = r.workTypeIds?.length ? r.workTypeIds : r.workTypeId ? [r.workTypeId] : []; return ids.map((id) => all.find((o) => String(o.value) === String(id))?.label).filter(Boolean).join(', '); };
const fmt = (f, v, refs) => {
  if (v === undefined || v === null || v === '' || v === 'null' || (Array.isArray(v) && !v.length)) return '';
  if (f?.key === 'requiredImages') return linesToKinds(v).map(kindName).join(', ');
  if (f?.type === 'photo' || f?.type === 'photos') return `картинок: ${Array.isArray(v) ? v.length : 1}`;
  if (f?.type === 'money') return money(v);
  if (f?.type === 'select') return (f.options || refs?.[f.ref] || []).find((o) => String(o.value) === String(v))?.label || '';
  return String(v);
};

// Группы меню (решение DICT 2026-10-25): серверные названия → понятные; порядок фиксирован
const GROUP_NAME = { 'Склад и позиции': 'Склад и продукция', 'Люди и ФОТ': 'Люди и работа', 'Заявки и счета': 'Заявки и оплата', 'Паспорта': 'Документы (паспорта)' };
const GROUP_ORDER = ['Склад и продукция', 'Люди и работа', 'Заявки и оплата', 'Документы (паспорта)'];
const PASS_GROUP = 'Документы (паспорта)';
const isAdmin = () => session.role === 'admin' || session.user?.isOwner === true;
const isLocked = (meta, r) => (meta?.locked || []).some((l) => (l.id && String(l.id) === String(r.id)) || (l.code && r.code && String(l.code) === String(r.code)));

export function mountDicts(params) {
  let groups = [];
  let data = null;
  let q = '';
  const openGroups = new Set(); // свёрнутая группа «Документы», открытая вручную
  const nav = h('nav', { class: 'panel', 'aria-label': 'Справочники' });
  const title = h('h2', null, '…');
  const hintEl = hintKit('');
  // общий поиск (ПО.3): пусто — весь справочник
  const sbx = searchBox({ placeholder: 'Найти по названию или коду…', label: 'Поиск значения', delay: 150, onSearch: (v) => { q = v; renderTable(); } });
  const search = sbx.el;
  const searchWrap = h('div', { class: 'search' }, search);
  let texts = null, tree = null, zonesView = null; // экраны: общие разделы / тексты / склады
  let qf = 'all'; // фильтр качества: все / дубли
  let sortMode = 'no'; // productGroups: no | name
  const addBtn = button({ label: '+ Добавить', kind: 'primary', onClick: () => patch({ of: 'dict', new: '1', open: undefined }) }); addBtn.hidden = !session.canEdit;
  const candBtn = button({ label: 'Найти в данных…', title: 'Значения, которые уже встречаются в заявках, на складе и в Google-таблице, но ещё не в справочнике', onClick: () => toggleCandidates() }); candBtn.hidden = !session.canEdit;
  const cand = h('div', { hidden: true }); const body = h('div');
  const box = h('section', { class: 'panel' }, toolbar(title, hintEl, searchWrap, candBtn, addBtn), cand, body);
  const el = h('div', h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Справочники'), h('div', { class: 'sub' }, 'Здесь меняются значения выпадающих списков: добавить, исправить, удалить. Изменение сразу видно во всех разделах'))), layout.split({ side: nav, main: box, sideLabel: 'Справочники' }));

  // Меню: серверные группы → 4 понятные + «Контрагенты»; «Документы» свёрнуты, пока не выбран справочник из неё
  function menuGroups() {
    const m = new Map();
    for (const g of groups) { const n = GROUP_NAME[g.group] || g.group; if (!m.has(n)) m.set(n, []); m.get(n).push(...g.items); }
    const rank = (n) => { const i = GROUP_ORDER.indexOf(n); return i < 0 ? 99 : i; };
    return [...m].map(([name, items]) => ({ name, items })).sort((a, b) => rank(a.name) - rank(b.name));
  }
  function renderNav() {
    const cur = dictKey();
    const gs = menuGroups().map((g) => {
      const pass = g.name === PASS_GROUP;
      const here = g.items.some((d) => d.key === cur) || cur === ZONES_KEY || (pass && cur === TEXTS_KEY);
      const items = [...g.items.map((d) => ({ key: d.key, label: d.title, count: d.count }))];
      if (g.name === GROUP_ORDER[0] && isAdmin()) items.push({ key: ZONES_KEY, label: 'Склады' });
      if (pass) items.push({ key: TEXTS_KEY, label: 'Общие разделы (шаблон)' });
      return { title: g.name, items, fold: pass, open: !pass || here || openGroups.has(g.name) };
    });
    gs.push({ title: 'Контрагенты', items: [{ key: '#partners', label: 'Поставщики, заказчики, наши компании', href: '#partners' }] });
    nav.replaceChildren(navList({ groups: gs, value: cur, label: 'Справочники', onPick: (k) => go('dicts', { d: k }, { replace: true }) }).el);
  }

  function renderTable() {
    if (!data) return;
    const { dict } = data;
    const cols = dict.columns.filter((c) => !(c.key === 'salaryRate' && !session.canPayroll));
    const fieldOf = (k) => dict.fields.find((f) => f.key === k);
    const tk = dictSearchTokens(q); // GALV_HOT / оцинк — dicts-search.js
    const dup = dupeCounts(data.items, (x) => (x.material ? `${x.material}|${x.name}` : x.name)); // дубль имени у того же материала
    if (!dup.size) qf = 'all';
    let rows = data.items.filter((x) => (qf !== 'dupes' || dup.has(x.id)) && (!tk.length || tk.every((w) => dictHaystack(x).includes(w))));
    if (dict.key === 'productGroups') rows = sortProductGroups(rows, sortMode);
    if (!data.items.length) {
      body.replaceChildren(empty({ title: 'Здесь пока ничего нет.', hint: canEditDict() ? 'Нажмите «+ Добавить» или «Найти в данных…» — возьмём то, что уже встречается в заявках и на складе.' : undefined }));
      return;
    }
    if (!rows.length) { body.replaceChildren(empty({ title: `Ничего не найдено по «${sbx.input.value}».`, hint: 'Попробуйте другое слово.' })); return; }
    const descOf = (r) => {
      if (dict.key === 'productGroups') return productGroupMeta(r);
      const bits = [];
      if (dict.key === 'passportMaterials') bits.push(badge(r.kind === 'coating' ? 'покрытие' : 'материал', r.kind === 'coating' ? 'info' : 'dim'));
      if (r.code) bits.push(h('span', { class: 'muted' }, String(r.code)));
      for (const c of cols.filter((col) => col.key !== 'name')) {
        const v = c.key === 'hex' && r.hex ? [colorBadge(r.hex), r.hex] : fmt(fieldOf(c.key), r[c.key], dict.refs) || (c.key === 'workTypeName' ? r.workTypeName : '');
        if (v && v.length !== 0) bits.push(v);
      }
      return bits.flatMap((x, i) => (i ? [' · ', x] : [x]));
    };
    const list = stack();
    for (const r of rows) {
      const lock = isLocked(dict, r);
      const acts = [];
      if (canEditDict()) {
        acts.push(button({ label: 'Изменить', kind: 'ghost', size: 'S', onClick: () => patch({ of: 'dict', open: r.id, new: undefined }) }));
        acts.push(lock ? lockBadge()
          : button({ label: 'Удалить', kind: 'ghost', size: 'S', onClick: (e) => removeItem(r, e.currentTarget) }));
      } else if (lock) acts.push(lockBadge());
      list.append(row({ title: dict.key === 'productGroups' ? productGroupTitle(r) : r.name, meta: descOf(r),
        side: qualityBadges({ dupe: dup.get(r.id) || 0, dupeHint: 'Такое же название есть у другой записи — объедините' }),
        action: acts,
        onClick: canEditDict() ? (e) => { if (!e.target.closest('button')) patch({ of: 'dict', open: r.id, new: undefined }); } : undefined }));
    }
    const tools = [];
    if (dict.key === 'productGroups') tools.push(...productGroupSortBtns(sortMode, (m) => { sortMode = m; renderTable(); }));
    if (dup.size) tools.push(qualityFilter({ value: qf, counts: { dupes: dup.size }, onChange: (v) => { qf = v; renderTable(); } }));
    body.replaceChildren(...(tools.length ? [toolbar(...tools)] : []), list);
  }

  // Удаление из списка: свободное — подтверждение; занятое — замена (только админ), иначе текст
  async function removeItem(r, btn) {
    const key = dictKey();
    const fin = busyBtn(btn, null, { delay: 250 });
    let u;
    try { u = await api(`/dicts/${key}/${r.id}/usage`); } catch (e) { fin(); toastError(e, 'Удалить'); return; }
    fin();
    if (!u.tracked || !u.busy) {
      if (!(await confirmDlg(`Удалить «${r.name}»?`, 'Значение пропадёт из списка. Вернуть можно сразу: кнопка «Отменить» после удаления.', { okText: 'Удалить', danger: true }))) return;
      try {
        await api(`/dicts/${key}/${r.id}`, { method: 'DELETE' });
        lookups.reset?.();
        toast('Значение удалено', { undo: async () => { try { await api(`/dicts/${key}/${r.id}/restore`, { method: 'POST' }); lookups.reset?.(); toast('Восстановлено'); await reload(); } catch (e) { toastError(e); } } });
        await reload();
      } catch (e) { toastError(e, 'Удалить'); }
      return;
    }
    const where = (u.sections || []).length ? u.sections.join(', ') : 'других разделах';
    // занятое значение удалить нельзя никому (иначе сломаются записи): предлагаем переименовать
    const go = await confirmDlg(`«${r.name}» используется — удалить нельзя`, `Используется в: ${where}. Если название не подходит, переименуйте — оно изменится везде.`, { okText: 'Переименовать', cancelText: 'Закрыть' });
    if (go) patch({ of: 'dict', open: r.id, new: undefined });
    return;
  }

  // «Найти в данных…» (СП.6): значения из заявок / склада / Google-таблицы, которых нет в справочнике — отметить и добавить
  async function toggleCandidates(force) {
    if (!cand.hidden && !force) { cand.hidden = true; return; }
    cand.hidden = false;
    cand.replaceChildren(h('p', { class: 'muted' }, 'Ищу в заявках, на складе и в Google-таблице…'));
    try {
      const r = await api(`/dicts/${dictKey()}/candidates`);
      if (!r.items.length) { cand.replaceChildren(hintKit('Всё, что встречается в данных, уже есть в справочнике.'),
        button({ label: 'Закрыть', size: 'S', onClick: () => { cand.hidden = true; } })); return; }
      const boxes = r.items.map((c) => ({ c, cb: h('input', { type: 'checkbox', checked: !c.similar }) }));
      const go2 = button({ label: 'Добавить отмеченные', kind: 'primary', size: 'S' });
      go2.addEventListener('click', async () => {
        const names = boxes.filter((b) => b.cb.checked).map((b) => b.c.name);
        if (!names.length) { toast('Отметьте, что добавить', { error: true }); return; }
        go2.disabled = true; go2.textContent = 'Добавляю…';
        try { const res = await api(`/dicts/${dictKey()}/import`, { method: 'POST', body: { names } }); toast(`Добавлено: ${res.added}`); cand.hidden = true; lookups.reset?.(); await reload(); }
        catch (e) { toastError(e); go2.disabled = false; go2.textContent = 'Добавить отмеченные'; }
      });
      cand.replaceChildren(
        section({ title: `Нашлось в данных, но нет в справочнике: ${r.items.length}`, open: true, body: [
          hintKit('Отмечено то, чего точно нет. «Похоже на …» — вероятно, то же самое другим написанием: такое лучше не добавлять, а потом объединить.'),
          ...boxes.map(({ c, cb }) => row({ lead: cb, title: c.name,
            meta: [c.uses ? `встречается ${qty(c.uses)} раз` : '', c.source].filter(Boolean).join(' · '),
            side: c.similar ? [badge(`похоже на «${c.similar.name}» ${Math.round(c.similar.score * 100)}%`, 'dim')] : null })),
          actions(go2, button({ label: 'Закрыть', size: 'S', onClick: () => { cand.hidden = true; } }))] }));
    } catch (e) { cand.replaceChildren(failBlock(e)); }
  }

  async function reloadTree() {
    try {
      const g = await api('/dicts');
      groups = g.items;
      title.textContent = 'Тексты паспорта'; hintEl.textContent = 'Что подставляется в паспорт: раздел → 2–3 варианта → текст. Менеджер выбирает вариант, а не пишет текст.';
      searchWrap.hidden = true; candBtn.hidden = true; addBtn.hidden = true; cand.hidden = true;
      renderNav();
      if (!tree) tree = mountTree();
      if (!body.contains(tree.el)) body.replaceChildren(tree.el);
      await tree.reload();
    } catch (e) { body.replaceChildren(failBlock(e, () => reloadTree())); }
  }

  async function reloadZones() {
    try {
      const g = await api('/dicts');
      groups = g.items;
      title.textContent = 'Склады'; hintEl.textContent = 'Какие позиции видит каждый склад: категории и отдельные позиции. Склад выбирается у роли; кладовщик видит только свой.';
      searchWrap.hidden = true; candBtn.hidden = true; addBtn.hidden = true; cand.hidden = true;
      renderNav();
      if (!zonesView) zonesView = mountZones();
      if (!body.contains(zonesView.el)) body.replaceChildren(zonesView.el);
      await zonesView.reload();
    } catch (e) { body.replaceChildren(failBlock(e, () => reloadZones())); }
  }

  async function reloadTexts() {
    try {
      const g = await api('/dicts');
      groups = g.items;
      title.textContent = 'Общие разделы паспорта'; hintEl.textContent = 'Шаблон разделов по категориям (общие указания, хранение, гарантия…): что общее для всех, что своё у категории и что его заменяет. Клик по пункту — правка справа.';
      searchWrap.hidden = true; candBtn.hidden = true; addBtn.hidden = true; cand.hidden = true;
      renderNav();
      if (!texts) texts = mountTexts();
      if (!body.contains(texts.el)) body.replaceChildren(texts.el);
      await texts.reload();
    } catch (e) { body.replaceChildren(failBlock(e, () => reloadTexts())); }
  }

  async function reload() {
    if (dictKey() === TEXTS_KEY) return reloadTexts();
    if (dictKey() === TREE_KEY) return reloadTree();
    if (dictKey() === ZONES_KEY) return reloadZones();
    searchWrap.hidden = false;
    try {
      const [g, d] = await Promise.all([api('/dicts'), api(`/dicts/${dictKey()}`)]);
      groups = g.items; data = d; curNewTitle = d.dict.newTitle || null;
      editRoles = g.items.flatMap((x) => x.items).find((i) => i.key === d.dict.key)?.editRoles || null;
      addBtn.hidden = !canEditDict();
      const meta = g.items.flatMap((x) => x.items).find((i) => i.key === d.dict.key) || {};
      if (!d.dict.sections && meta.sections) d.dict.sections = meta.sections;
      if (!d.dict.locked && meta.locked) d.dict.locked = meta.locked;
      title.textContent = d.dict.title;
      hintEl.textContent = d.dict.sections?.length ? `Применяется в: ${d.dict.sections.join(', ')}` : d.dict.hint || '';
      candBtn.hidden = !canEditDict() || ['colors', 'worktypes', 'payoutSchedules'].includes(d.dict.key);
      renderNav(); renderTable();
    } catch (e) { body.replaceChildren(failBlock(e, () => reload())); }
  }
  let shown = params.d;
  reload();
  return {
    el, reload,
    update: (p) => { if (p.d === TEXTS_KEY && shown === TEXTS_KEY) { texts?.update(); return; } if (p.d === TREE_KEY && shown === TREE_KEY) { tree?.update(); return; } if (p.d === ZONES_KEY && shown === ZONES_KEY) { zonesView?.reload(); return; } if (p.d !== shown) { shown = p.d; q = ''; qf = 'all'; sbx.set('', true); cand.hidden = true; data = null; body.replaceChildren(busyBlock('справочник', { retry: () => reload() })); reload(); } },
  };
}

/** Объединить дубль: всё связанное перейдёт к выбранному, этот — в корзину. */
async function mergeDialog(r, ctx) {
  const all = (await api(`/dicts/${dictKey()}`)).items.filter((x) => x.id !== r.id);
  const sel = enhanceSelect(select({ options: [['', '— выберите —'], ...all.map((x) => [x.id, x.name])], label: 'Оставить' }));
  const done = await modal({
    title: 'Объединить «' + r.name + '»',
    okText: 'Объединить',
    body: h('div', null,
      hintKit(`Это то же самое, что другое значение (дубль, другое написание)? Всё, где используется «${r.name}», перейдёт к выбранному, а «${r.name}» уйдёт в корзину.`),
      h('label', { class: 'field' }, h('span', null, 'Оставить'), sel)),
    onOk: async () => {
      if (!sel.value) throw new Error('Выберите, с чем объединить');
      return api(`/dicts/${dictKey()}/${r.id}/merge`, { method: 'POST', body: { intoId: sel.value } });
    },
  });
  if (done) { toast(`Объединено: перенесено записей — ${done.moved}`); lookups.reset?.(); ctx.close(); window.dispatchEvent(new CustomEvent('data-changed')); patch({ of: 'dict', open: done.id }); }
}

/** Карточка справочника (правая панель): открывается из «Справочников» (of=dict). */
/** Справочник с ограничением правки (`editRoles`, группа «Паспорта» — директор и админ); остальные — как раньше. */
let editRoles = null;
function canEditDict() {
  if (!session.canEdit) return false;
  if (!editRoles || session.user?.isOwner === true) return true;
  return editRoles.some((r) => (r === 'director' ? ['admin', 'director'] : [r]).includes(session.role));
}

/** Поля-картинки справочника (photo — одна, photos — несколько; БЗ-6 Э9.7). */
const isPhoto = (f) => f.type === 'photo' || f.type === 'photos';
/** «foundation\nholes» → ['foundation','holes'] (safety_zone = safety; «(если разборное)» не теряем — assembly). */
const linesToKinds = (v) => [...new Set(String(v || '').replace(/\([^)]*\)/g, ' ').split(/[\s,;]+/).filter((x) => /^[a-z_]+$/.test(x)).map((k) => (k === 'safety_zone' ? 'safety' : k)))];
/** Метки видов: известные + неизвестные из значения (не терять при сохранении). */
const kindOptions = (v) => {
  const known = [...KINDS, ...KINDS_V2].map(([value, label, sub]) => ({ value, label, sub }));
  return [...known, ...linesToKinds(v).filter((k) => !known.some((o) => o.value === k)).map((k) => ({ value: k, label: k, sub: 'вид не из списка' }))];
};
const idsOf = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String);
let photoKeys = new Map();
function photoStrip(r, f) {
  const ids = idsOf(r[f.key]).filter((id) => r.photos?.[id]);
  if (!ids.length) return '';
  return kitPhotoStrip(ids.map((id) => ({ url: r.photos[id].url, thumb: r.photos[id].thumb })));
}
/** Цвет-кружок (эталон badge dot). */
const colorBadge = (hex) => badge(hex, 'dim', { dot: hex });
/** Замок «Встроено в программу» (эталон badge). */
const lockBadge = () => { const b = badge('🔒 Встроено в программу', 'dim'); b.title = 'Это значение нужно программе — удалить нельзя'; return b; };

let curNewTitle = null; // заголовок «Новый …» открытого справочника (из GET /dicts/:key)
export const dict = {
  id: 'dict',
  canEdit: canEditDict,
  title: 'Справочники',
  // заголовок правой панели новой записи — что именно добавляем (2026-10-25)
  get newTitle() { return curNewTitle || 'Новая запись'; },
  entityType: 'DictItem',
  historyLabels: { 'dict.created': 'Добавлено', 'dict.updated': 'Изменено', 'dict.deleted': 'Удалено', 'dict.restored': 'Восстановлено', 'dict.merged': 'Объединено' },
  get: (id) => api(`/dicts/${dictKey()}/${id}`),
  card: {
    heading: (r) => r.name,
    subheading: (r) => r.dictInfo?.title || '',
    startEdit: () => true, // «Изменить» в списке — сразу правка в правой панели
    view: (r) => (r.dictInfo?.fields || []).filter((f) => !['name', 'firstName', 'lastName', 'patronymic'].includes(f.key) || r.dict === 'persons')
      .filter((f) => f.type !== 'money' || session.canMoney)
      .map((f) => [f.key === 'workTypeId' && r.dict === 'persons' ? 'Виды работ' : f.label, f.key === 'workTypeId' && r.dict === 'persons' ? workTypesText(r) : isPhoto(f) ? photoStrip(r, f) : f.type === 'color' && r[f.key] ? h('span', null, colorBadge(r[f.key]), ' ', r[f.key]) : fmt(f, r[f.key], r.dictInfo.refs)]),
    actions: (r) => [{ label: 'Объединить с…', run: (row, ctx) => mergeDialog(row, ctx) }],
  },
  form: {
    // поля и списки выбора — с сервера (описание справочника), чтобы форма всегда совпадала с тем, что он хранит
    fields: async (r) => {
      const info = r?.dictInfo || (await api(`/dicts/${dictKey()}`)).dict;
      photoKeys = new Map(info.fields.filter(isPhoto).map((f) => [f.key, f.type]));
      // «К каким категориям» — галочками-чипами (общий кусочек ui/cat-chips.js), а не строкой кодов «TRN, WRK»
      const catField = info.fields.find((f) => f.key === 'categories' && dictKey() !== 'passportCategories');
      const catOpts = catField ? (await passportCategoryOptions()).map((c) => ({ code: c.value, name: c.label })) : [];
      // выбор из справочника вместо строки кодов (ref: { dict, multiple }) — списки грузим один раз на форму
      const refOpts = {};
      for (const f of info.fields.filter((x) => x.ref?.dict)) {
        const dicts = String(f.ref.dict).split(',').map((x) => x.trim()).filter(Boolean);
        refOpts[f.key] = (await Promise.all(dicts.map((d) => api('/dicts/' + d).catch(() => null).then((x) => (x?.items || []).filter((c) => c.code).map((c) => ({ code: String(c.code), name: c.name, group: dicts.length > 1 ? x?.dict?.title || d : '' })))))).flat();
      }
      const isNew = !r?.id;
      // productGroups (новая запись): список существующих для предупреждения о дублях по имени и номеру
      const pgItems = isNew && dictKey() === 'productGroups'
        ? await api('/dicts/productGroups').then((x) => x.items).catch(() => null)
        : null;
      // «Используется в: …» из /usage (сбой — без строки; правка при этом работает)
      const u = isNew ? null : await api(`/dicts/${dictKey()}/${r.id}/usage`).catch(() => null);
      const secs = (u?.sections || []).join(', ') || 'других разделах';
      const NAME_KEYS = ['name', 'firstName', 'lastName'];
      const usageField = isNew ? null : { key: '_usage', label: '', type: 'widget', wide: true, summary: () => '',
        widget: () => ({ el: h('div', null,
          u && u.tracked !== false ? h('div', { class: 'muted' }, u.busy ? `Используется в: ${secs}` : 'Нигде не используется') : null,
          canEditDict() ? button({ label: 'Объединить с…', size: 'S', onClick: () => mergeDialog(r, { close() {} }) }) : null),
        get value() { return ''; }, set value(x) { void x; }, focus() {} }) };
      // «Виды работ» сотрудника — несколько, галочками (workTypeIds; от них зависит, кого предложат на карточку в «В работе»)
      const wtOpts = (info.refs?.worktypes || []).map((o) => ({ code: String(o.value), name: o.label }));
      const one = (f) => (dictKey() === 'persons' && f.key === 'workTypeId' ? { key: 'workTypeIds', label: 'Виды работ', type: 'widget', wide: true, hint: 'Можно несколько. Только такие люди видны в Ганте и получают шаги этих работ.', summary: () => '',
        widget: (v) => refChipsField(wtOpts, { label: 'Виды работ', value: v, multiple: true }) }
        : f === catField && catOpts.length ? { key: f.key, label: f.label, type: 'widget', wide: true, hint: f.hint || '«Для всех» — подходит любой категории', summary: () => '',
        widget: (v) => catChipsField(catOpts, { label: f.label, value: v, later: ['DIO', 'DSP'] }) }
        : f.ref?.dict || f.multi ? { key: f.key, label: f.label, type: 'widget', wide: true, hint: f.hint, summary: () => '', // multi: несколько из refs сервера (статья → категории склада)
          widget: (v) => refChipsField(f.multi ? (info.refs?.[f.ref] || []).map((o) => ({ code: String(o.value), name: o.label })) : refOpts[f.key] || [], { label: f.label, value: v, multiple: f.multi || f.ref.multiple !== false }), mount: f.multi ? (fapi) => { const sync = () => { const l = fapi.field(f.key); if (l) l.hidden = !fapi.get('parentId'); }; fapi.on('parentId', sync); sync(); } : undefined } // чипы категорий — только у подстатьи
        : f.lockAfterCreate && !isNew && (f.key === 'code' || r[f.key]) ? { key: f.key, label: f.label, type: 'widget', hint: f.key === 'code' ? 'Не меняется: на него ссылаются тексты и изделия' : 'Не меняется: ' + (f.hint || 'на него ссылаются изделия'), summary: () => '',
          widget: (v) => ({ el: h('span', { class: 'muted' }, String(v ?? '')), get value() { return JSON.stringify(String(v ?? '')); }, set value(x) { void x; }, focus() {} }) }
        : {
        key: f.key, label: !isNew && f.key === 'name' ? 'Новое значение' : f.label, required: !!f.required && !(f.key === 'code' && f.lockAfterCreate && isNew), wide: !!f.wide,
        ...(!isNew && NAME_KEYS.includes(f.key) && u?.busy ? { warn: (v) => (String(v ?? '').trim() && String(v).trim() !== String(r[f.key] ?? '') ? `Новое название сменится везде: ${secs}.` : null) }
          : isNew && pgItems && (NAME_KEYS.includes(f.key) || f.key === 'groupNo') ? { warn: (v) => {
            const t = String(v ?? '').trim();
            if (!t) return null;
            if (f.key === 'groupNo') {
              const found = pgItems.find((x) => String(x.groupNo) === t);
              return found ? `Номер уже занят группой «${found.name}»` : null;
            }
            const found = pgItems.find((x) => String(x.name ?? '').toLowerCase() === t.toLowerCase());
            return found ? `Группа «${found.name}» уже есть${found.groupNo ? ` (№${found.groupNo})` : ''} — не нужно создавать заново.` : null;
          }} : {}),
        hint: f.key === 'code' && f.lockAfterCreate && isNew ? 'Заполнится само из названия' : f.hint, max: 300,
        ...(f.key === 'requiredImages' ? { widget: (v) => tagPick({ options: kindOptions(v), value: linesToKinds(v), label: f.label }), hint: 'Отметьте рисунки, без которых паспорт этой категории не выдаётся' } : {}),
        type: f.key === 'requiredImages' ? 'widget' : isPhoto(f) ? 'photos' : f.type === 'money' ? 'money' : f.type === 'select' ? 'select' : f.type === 'textarea' ? 'textarea' : f.type === 'date' ? 'date' : 'text',
        money: f.type === 'money',
        placeholder: f.type === 'color' ? '#2e7d32' : undefined,
        options: f.type === 'select' ? (f.options || info.refs?.[f.ref] || []) : undefined,
      });
      // поля, которые после создания не меняются (код элемента и т. п.), — не поля формы: тихой строкой внизу, текстом
      const isFixed = (f) => f.lockAfterCreate && !isNew && (f.key === 'code' || r[f.key]);
      const fixedLine = info.fields.filter(isFixed).map((f) => ({ note: `${f.key === 'code' ? 'Код элемента' : f.label}: ${String(r[f.key] ?? '')}` }));
      // служебные поля (tech) — внизу, в свёрнутом блоке; остальные — сверху в порядке описания
      const main = [...(usageField ? [usageField] : []), ...info.fields.filter((f) => !f.tech && !isFixed(f)).map(one)];
      const tech = info.fields.filter((f) => f.tech && !isFixed(f)).map(one);
      return [...main, ...(tech.length ? [{ section: 'Дополнительно', tone: 'info', collapsed: true }, { note: 'Меняется редко — только если точно знаете, зачем. Пояснение — под полем.' }, ...tech] : []), ...fixedLine];
    },
    initial: () => (dictKey() === 'persons' ? { status: 'active' } : {}),
    // картинки (БЗ-6 Э9.7): в форме — загрузка/вставка как везде; в базе — id фото (photo — один, photos — список)
    toInitial: (r) => ({ ...r, workTypeIds: r.workTypeIds?.length ? r.workTypeIds : r.workTypeId ? [r.workTypeId] : [], ...Object.fromEntries((r.dictInfo?.fields || []).filter(isPhoto).map((f) => [f.key, idsOf(r[f.key]).map((id) => ({ id, url: r.photos?.[id]?.url, thumb: r.photos?.[id]?.thumb || r.photos?.[id]?.url }))])) }),
    toBody: (v) => Object.fromEntries(Object.entries(v).filter(([k, x]) => !k.startsWith('_') && !(k === 'code' && (x === '' || x == null))).map(([k, x]) => [k, k === 'workTypeIds' ? String(x || '').split(',').map((t) => t.trim()).filter(Boolean) : k === 'requiredImages' ? (Array.isArray(x) ? x.map((kind) => (kind === 'assembly' ? 'assembly (если разборное)' : kind)).join('\n') : '') : photoKeys.get(k) === 'photo' ? (Array.isArray(x) ? x[0] || '' : '') : x === null || x === undefined ? (photoKeys.has(k) ? [] : '') : x])),
    create: (b) => api(`/dicts/${dictKey()}`, { method: 'POST', body: b }).then((r) => { lookups.reset?.(); return r; }),
    update: (id, b) => api(`/dicts/${dictKey()}/${id}`, { method: 'PATCH', body: b }).then((r) => { lookups.reset?.(); if (r?.moved > 0) toast('Название изменено везде'); return r; }),
  },
  remove: { noTrash: true, // значения справочников на экране «Корзина» не показываются: у каждого справочника свой адрес
    text: (r) => `Удалить «${r.name}» из справочника «${r.dictInfo?.title || ''}»?`,
    run: (r) => api(`/dicts/${dictKey()}/${r.id}`, { method: 'DELETE' }).then(() => lookups.reset?.()),
    restore: (r) => api(`/dicts/${dictKey()}/${r.id}/restore`, { method: 'POST' }).then(() => lookups.reset?.()),
  },
};
