import { FINANCIAL_KEYS, financialDictTable, financialDictFields, financialArticleBody, financialDictWrite } from './dicts-financial-articles.js';
import { loadFinancialArticles } from './financial-articles.js';
import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { busyBlock, failBlock } from '../ui/kit/busy.js';
import { current, go, patch } from '../core/router.js';
import { modal } from '../ui/kit/dialog.js';
import { toast } from '../ui/kit/toast.js';
import { lookups } from './lookups.js';
import { KINDS, KINDS_V2, kindName } from '../core/passport-kinds.js';
import { searchBox, tagPick, button, select, enhanceSelect, navList, layout, stack, toolbar, headbar, pad, section, actions, badge, empty, hint as hintKit, photoStrip as kitPhotoStrip } from '../ui/kit/index.js';
import { filterPanel } from '../ui/kit/filter-panel.js';
import { mountTexts, TEXTS_KEY } from './passport-texts.js';
import { mountTree, TREE_KEY } from './passport-tree.js';
import { mountZones, ZONES_KEY } from './stock-zones.js';
import { catChipsField, refChipsField, passportKindElements } from '../ui/cat-chips.js';
import { dupeCounts, qualityBadges, qualityFilter } from '../ui/quality.js';
import { passportCategoryOptions } from './passports/common.js';
import { dictSearchTokens, dictHaystack, buildDictsNav, flatNavItems } from './dicts-search.js';
import { dictsTable, fmt, linesToKinds, loadCodeNames, productGroupSortBtns, SCOPE_DICTS, offeredInPassportList } from './dicts-sort.js';
import { removeDictItem, toggleDictCandidates } from './dicts-ops.js';
import { CAT_NAMES } from '../core/passport-kinds.js';
/** Справочники: #dicts?d=…; карточка of=dict; ptexts/passportPhrases/склады — отдельные экраны. */
const dictKey = () => current().params.d || 'categories';
const workTypesText = (r) => { const all = r.dictInfo?.refs?.worktypes || []; const ids = r.workTypeIds?.length ? r.workTypeIds : r.workTypeId ? [r.workTypeId] : []; return ids.map((id) => all.find((o) => String(o.value) === String(id))?.label).filter(Boolean).join(', '); };
const isAdmin = () => session.role === 'admin' || session.user?.isOwner === true;
const isLocked = (meta, r) => (meta?.locked || []).some((l) => (l.id && String(l.id) === String(r.id)) || (l.code && r.code && String(l.code) === String(r.code)));
export function mountDicts(params) {
  let groups = [];
  let data = null;
  let q = '', menuQ = '', sectionFilter = '', kindFilter = '', catFilter = '', scopeMode = 'short';
  let passCats = []; // типы паспорта для фильтра «как в выпадающем списке»
  let loadId = 0, loading = true, failed = false;
  const expanded = new Map(); let navCur = null; // navCur — справочник, для которого меню раскрывалось в последний раз
  const nav = h('nav', { class: 'panel', 'aria-label': 'Справочники' }, busyBlock('список справочников')); // до ответа сервера — не пустая панель
  const title = h('h2', null, '…');
  const hintEl = hintKit('');
  const sbx = searchBox({ placeholder: 'Название, код или описание', label: 'Поиск в справочнике', delay: 150, onSearch: (v) => { q = v; renderTable(); } });
  const menuSearch = searchBox({ label: 'Найти справочник', placeholder: 'Название справочника', delay: 150, onSearch: (v) => { menuQ = v; renderNav(); } });
  const navBody = h('div');
  const filters = stack();
  let texts = null, tree = null, zonesView = null;
  let qf = 'all'; // фильтр качества: все / дубли
  let sortMode = 'no'; // productGroups: no | name
  const addBtn = button({ label: '+ Добавить', kind: 'primary', onClick: () => patch({ of: 'dict', new: '1', open: undefined }) }); addBtn.hidden = true; // до загрузки справочника права неизвестны (паспортные — директор и админ): покажет reload()
  const candBtn = button({ label: 'Найти в данных…', title: 'Значения, которые уже встречаются в заявках, на складе и в Google-таблице, но ещё не в справочнике', onClick: () => toggleDictCandidates({ cand, dictKey: dictKey(), reload, force: false }) }); candBtn.hidden = true;
  const cand = h('div', { hidden: true }); const body = h('div');
  const results = h('div', null, cand, body), summary = h('div');
  const layoutHost = pad(results), panelResults = h('div');
  const panel = filterPanel({ key: 'dicts-records', search: sbx.el, fields: filters, content: panelResults });
  const panelSearch = sbx.el.parentElement;
  let layoutMode = 'special';
  function arrange(mode) {
    if (mode === layoutMode) return;
    layoutMode = mode;
    if (mode === 'filtered') { panelSearch.append(sbx.el); panelResults.append(summary, results); layoutHost.replaceChildren(panel.el); }
    else layoutHost.replaceChildren(...(mode === 'search' ? [sbx.el, summary, results] : [results]));
  }
  const box = h('section', { class: 'panel' }, pad(headbar(h('div', { class: 'dict-titles' }, title, hintEl), actions(candBtn, addBtn))), layoutHost);
  const el = h('div', h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Справочники'), h('div', { class: 'sub' }, 'Здесь меняются значения выпадающих списков: добавить, исправить, удалить. Изменение сразу видно во всех разделах'))), layout.split({ side: nav, main: box, sideLabel: 'Справочники' }));
  function renderNav() {
    const cur = dictKey();
    const markOpen = cur !== navCur;
    if (markOpen) navCur = cur;
    const { gs, visible } = buildDictsNav({
      serverGroups: groups, admin: isAdmin(), zonesKey: ZONES_KEY, textsKey: TEXTS_KEY,
      term: menuQ, cur, expanded, markOpen,
    });
    navBody.replaceChildren(visible.length ? navList({ groups: visible, value: cur, label: 'Справочники', onPick: (k) => {
      const parent = gs.find((g) => flatNavItems(g).some((it) => it.key === k));
      if (parent) {
        expanded.set(parent.title, true);
        (parent.groups || []).forEach((sg) => { if (sg.items.some((it) => it.key === k)) expanded.set(sg.title, true); });
      }
      go('dicts', { d: k }, { replace: true });
    } }).el : empty({ title: 'Справочник не найден', kind: 'notFound', onReset: () => menuSearch.clear(), resetLabel: 'Очистить поиск' }));
    if (!nav.contains(navBody)) nav.replaceChildren(pad(h('label', { class: 'field' }, h('span', null, 'Найти справочник'), menuSearch.el)), navBody);
    // после перерисовки — активный пункт в зоне видимости (не оставлять скролл на «Статьях расходов»)
    requestAnimationFrame(() => navBody.querySelector('.k-nav-item.on')?.scrollIntoView({ block: 'nearest' }));
  }
  function renderTable() {
    const dict = data?.dict || { key: dictKey(), columns: [], fields: [], refs: {} };
    if (FINANCIAL_KEYS.has(dict.key) && data?.financialTree) { summary.replaceChildren(); arrange('search'); body.replaceChildren(financialDictTable(data.financialTree, { q, canEdit: canEditDict(), redraw: renderTable })); return; }
    const items = data?.items || [];
    const cols = dict.columns.filter((c) => !(c.key === 'salaryRate' && !session.canPayroll));
    const fieldOf = (k) => dict.fields.find((f) => f.key === k);
    const tk = dictSearchTokens(q); // GALV_HOT / оцинк — dicts-search.js
    const dup = dupeCounts(items, (x) => (x.material ? `${x.material}|${x.name}` : x.name)); // дубль имени у того же материала
    const sections = dict.key === 'productGroups' ? (dict.refs?.productSections || []) : [];
    const supportsKind = dict.fields.some((f) => f.key === 'kind' && (f.options || []).some((o) => o.value === 'material') && (f.options || []).some((o) => o.value === 'coating'));
    const supportsScope = SCOPE_DICTS.has(dict.key);
    const count = [qf !== 'all', sectionFilter, kindFilter, catFilter, scopeMode !== 'short'].filter(Boolean).length;
    const reset = () => { sbx.set('', true); q = ''; qf = 'all'; sectionFilter = ''; kindFilter = ''; catFilter = ''; scopeMode = 'short'; renderTable(); };
    const rows = items.filter((x) => (qf !== 'dupes' || dup.has(x.id))
      && (!sectionFilter || (sectionFilter === '__none' ? !x.parentId : String(x.parentId) === sectionFilter))
      && (!kindFilter || (x.kind || 'material') === kindFilter)
      && (!catFilter || offeredInPassportList(dict.key, x, catFilter, scopeMode))
      && (!tk.length || tk.every((w) => dictHaystack(x).includes(w))));
    const controls = [qualityFilter({ value: qf, counts: { dupes: data ? dup.size : null }, onChange: (v) => { qf = v; renderTable(); } })];
    if (dict.key === 'productGroups') controls.push(h('label', { class: 'field' }, h('span', null, 'Раздел'), select({ label: 'Раздел', value: sectionFilter, options: [['', 'Все разделы'], ['__none', 'Без раздела'], ...sections.map((o) => [String(o.value), o.label])], onChange: (v) => { sectionFilter = v; renderTable(); } })));
    if (supportsKind) controls.push(h('label', { class: 'field' }, h('span', null, 'Вид'), select({ label: 'Вид', value: kindFilter, options: [['', 'Все'], ['material', 'Материалы'], ['coating', 'Покрытия']], onChange: (v) => { kindFilter = v; renderTable(); } })));
    if (supportsScope && passCats.length) {
      controls.push(h('label', { class: 'field' }, h('span', null, 'Как у типа паспорта'), select({
        label: 'Как у типа паспорта',
        value: catFilter,
        options: [['', 'Все записи'], ...passCats.map((o) => [String(o.value), o.label || CAT_NAMES[o.value] || o.value])],
        onChange: (v) => { catFilter = v; if (!v) scopeMode = 'short'; renderTable(); },
      })));
      // части/элементы: пусто ≠ «другие» — только короткий список по типу
      if (catFilter && dict.key !== 'passportParts' && dict.key !== 'passportElements') {
        controls.push(h('label', { class: 'field' }, h('span', null, 'Какой список'), select({
          label: 'Какой список',
          value: scopeMode,
          options: [
            ['short', 'Короткий (как сначала)'],
            ['other', 'Другие типы'],
            ['all', 'Все, в т.ч. «не в новых»'],
          ],
          onChange: (v) => { scopeMode = v || 'short'; renderTable(); },
        })));
      }
    }
    const activeControls = controls.filter(control => !control.hidden);
    const hasFilters = activeControls.length > 0;
    const summaryControls = dict.key === 'productGroups' ? productGroupSortBtns(sortMode, (m) => { sortMode = m; renderTable(); }) : [];
    if (data && !loading && !failed) summaryControls.push(h('span', { class: 'muted', role: 'status' }, `Найдено ${rows.length} из ${items.length}`));
    if (count || q.trim()) (hasFilters ? activeControls : summaryControls).push(button({ label: 'Сбросить всё', kind: 'ghost', cls: 'ls-reset', onClick: reset }));
    summary.replaceChildren(toolbar(...summaryControls));
    arrange(hasFilters ? 'filtered' : 'search');
    panel.setCount(count);
    filters.replaceChildren(...activeControls);
    if (loading || failed || !data) return;
    if (!items.length) { body.replaceChildren(empty({ title: 'Справочник пока пуст', hint: canEditDict() ? 'Добавьте запись кнопкой «Добавить».' : undefined })); return; }
    if (!rows.length) { body.replaceChildren(empty({ title: 'По выбранным условиям ничего не найдено', hint: 'Измените поиск или снимите ограничения.' })); return; }
    const catLabel = passCats.find((c) => String(c.value) === catFilter)?.label || CAT_NAMES[catFilter] || catFilter;
    const scopeNote = catFilter
      ? hintKit(scopeMode === 'other'
        ? `Группа «Другие» у типа «${catLabel}» — в книжке после «Показать все».`
        : scopeMode === 'all'
          ? `Все записи, включая «Не предлагать в новых» — в обычном выборе изделия их нет.`
          : `Короткий список у типа «${catLabel}» — как сначала в книжке/таблице материалов (без «не в новых»).`)
      : (supportsScope ? hintKit('Колонка «Кому предлагают» — основание. Фильтр типа + «Какой список» = как в книжке.') : null);
    body.replaceChildren(
      ...(scopeNote ? [scopeNote] : []),
      dictsTable({
        dictKey: dict.key, rows, cols, codeNames: data.codeNames, sortMode, onSort: (m) => { sortMode = m; renderTable(); },
        canEdit: canEditDict(), isLocked: (r) => isLocked(dict, r), lockBadge, colorBadge,
        fieldOf: (k) => fieldOf(k), fmt: (f, v) => fmt(f, v, dict.refs), dup,
        openId: current().params.open,
        qualityCell: (r) => { const m = qualityBadges({ dupe: dup.get(r.id) || 0, dupeHint: 'Такое же название есть у другой записи — объедините' }); return m.length ? h('span', null, ...m) : ''; },
        onOpen: (r) => patch({ of: 'dict', open: r.id, new: undefined }),
        onEdit: (r) => patch({ of: 'dict', open: r.id, new: undefined }),
        onRemove: (r, btn) => removeDictItem({ dictKey: dictKey(), row: r, btn, reload }),
      }),
    );
  }
  async function reloadTree(id) {
    try {
      const g = await api('/dicts');
      if (id !== loadId) return;
      groups = g.items;
      title.textContent = 'Тексты паспорта'; hintEl.textContent = 'Зачем: готовые тексты разделов без ручного набора. Пример: Назначение → вариант → абзац. Раздел → 2–3 варианта → текст. Менеджер выбирает, а не пишет.';
      arrange('special'); candBtn.hidden = true; addBtn.hidden = true; cand.hidden = true;
      renderNav();
      if (!tree) tree = mountTree();
      if (!body.contains(tree.el)) body.replaceChildren(tree.el);
      await tree.reload();
    } catch (e) { if (id === loadId) body.replaceChildren(failBlock(e, () => reload())); }
  }
  async function reloadZones(id) {
    try {
      const g = await api('/dicts');
      if (id !== loadId) return;
      groups = g.items;
      title.textContent = 'Склады'; hintEl.textContent = 'Какие позиции видит каждый склад: категории и отдельные позиции. Склад выбирается у роли; кладовщик видит только свой.';
      arrange('special'); candBtn.hidden = true; addBtn.hidden = true; cand.hidden = true;
      renderNav();
      if (!zonesView) zonesView = mountZones();
      if (!body.contains(zonesView.el)) body.replaceChildren(zonesView.el);
      await zonesView.reload();
    } catch (e) { if (id === loadId) body.replaceChildren(failBlock(e, () => reload())); }
  }
  async function reloadTexts(id) {
    try {
      const g = await api('/dicts');
      if (id !== loadId) return;
      groups = g.items;
      title.textContent = 'Общие разделы паспорта'; hintEl.textContent = 'Зачем: шаблон разделов PDF по типам. Пример: хранение, гарантия — общее «для всех» или своё у воркаута. Клик по пункту — правка справа.';
      arrange('special'); candBtn.hidden = true; addBtn.hidden = true; cand.hidden = true;
      renderNav();
      if (!texts) texts = mountTexts();
      if (!body.contains(texts.el)) body.replaceChildren(texts.el);
      await texts.reload();
    } catch (e) { if (id === loadId) body.replaceChildren(failBlock(e, () => reload())); }
  }
  async function reload() {
    const id = ++loadId, key = dictKey();
    if (key === TEXTS_KEY) return reloadTexts(id);
    if (key === TREE_KEY) return reloadTree(id);
    if (key === ZONES_KEY) return reloadZones(id);
    loading = true; failed = false; renderTable();
    try {
      const [g, d] = await Promise.all([api('/dicts'), api(`/dicts/${key}`)]);
      if (FINANCIAL_KEYS.has(key)) d.financialTree = await loadFinancialArticles({ type: key === 'expenseArticles' ? 'expense' : key === 'incomeArticles' ? 'income' : undefined, includeUsage: true, refresh: true });
      d.codeNames = await loadCodeNames(d.dict, api); if (id !== loadId) return; // коды соседних справочников → названия
      passCats = SCOPE_DICTS.has(key) ? await passportCategoryOptions().catch(() => []) : [];
      if (id !== loadId) return;
      groups = g.items; data = d; loading = false; curNewTitle = d.dict.newTitle || null;
      editRoles = g.items.flatMap((x) => x.items).find((i) => i.key === d.dict.key)?.editRoles || null;
      stockReadOnly = d.dict.readOnly === true;
      addBtn.hidden = !canEditDict();
      const meta = g.items.flatMap((x) => x.items).find((i) => i.key === d.dict.key) || {};
      if (!d.dict.sections && meta.sections) d.dict.sections = meta.sections;
      if (!d.dict.locked && meta.locked) d.dict.locked = meta.locked;
      title.textContent = d.dict.title;
      // C145: сверху — зачем справочник (с примером), затем где видно
      const why = [stockReadOnly ? 'Только просмотр: вашей роли недоступна правка справочников.' : '', FINANCIAL_KEYS.has(d.dict.key) ? 'Переименовывайте и переносите статьи, сохраняя связи с документами и суммы.' : String(d.dict.hint || '').trim()].filter(Boolean).join(' ');
      const where = d.dict.sections?.length ? `Где видно: ${d.dict.sections.join(', ')}` : '';
      hintEl.textContent = [why, where].filter(Boolean).join(' · ') || '';
      candBtn.hidden = FINANCIAL_KEYS.has(d.dict.key) || !canEditDict() || ['colors', 'worktypes', 'payoutSchedules'].includes(d.dict.key);
      renderNav(); renderTable();
    } catch (e) { if (id === loadId) { loading = false; failed = true; renderTable(); body.replaceChildren(failBlock(e, () => reload())); } }
  }
  let shown = params.d;
  reload();
  return {
    el, reload,
    update: (p) => { if (p.d === TEXTS_KEY && shown === TEXTS_KEY) { texts?.update(); return; } if (p.d === TREE_KEY && shown === TREE_KEY) { tree?.update(); return; } if (p.d === ZONES_KEY && shown === ZONES_KEY) { zonesView?.reload(); return; } if (p.d !== shown) { shown = p.d; sbx.clear(); q = ''; qf = 'all'; sectionFilter = ''; kindFilter = ''; catFilter = ''; scopeMode = 'short'; cand.hidden = true; data = null; addBtn.hidden = true; candBtn.hidden = true; body.replaceChildren(busyBlock('справочник', { retry: () => reload() })); reload(); } },
  };
}
/** Объединить дубль: всё связанное перейдёт к выбранному, этот — в корзину. */
async function mergeDialog(r, ctx) {
  if (FINANCIAL_KEYS.has(dictKey())) { toast('Объединение статей недоступно. Используйте перенос или архив.', { error: true }); return; }
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
let stockReadOnly = false;
function canEditDict() {
  if (!session.canEdit || stockReadOnly) return false;
  if (!editRoles || session.user?.isOwner === true) return true;
  return editRoles.some((r) => (r === 'director' ? ['admin', 'director'] : [r]).includes(session.role));
}

/** Поля-картинки справочника (photo — одна, photos — несколько; БЗ-6 Э9.7). */
const isPhoto = (f) => f.type === 'photo' || f.type === 'photos';
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
  popout: false,
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
    actions: (r) => FINANCIAL_KEYS.has(dictKey()) ? [] : [{ label: 'Объединить с…', run: (row, ctx) => mergeDialog(row, ctx) }],
  },
  form: {
    // поля и списки выбора — с сервера (описание справочника), чтобы форма всегда совпадала с тем, что он хранит
    fields: async (r, key = dictKey()) => {
      const info = r?.dictInfo || (await api(`/dicts/${key}`)).dict;
      if (FINANCIAL_KEYS.has(key)) { photoKeys = new Map(); return financialDictFields(r, key, info); }
      photoKeys = new Map(info.fields.filter(isPhoto).map((f) => [f.key, f.type]));
      // «К каким типам паспорта» — галочками-чипами (общий кусочек ui/cat-chips.js), а не строкой кодов «TRN, WRK»
      const catField = info.fields.find((f) => f.key === 'categories' && key !== 'passportCategories');
      const catOpts = catField ? (await passportCategoryOptions()).map((c) => ({ code: c.value, name: c.label })) : [];
      // выбор из справочника вместо строки кодов (ref: { dict, multiple }) — списки грузим один раз на форму
      const refOpts = {};
      for (const f of info.fields.filter((x) => x.ref?.dict)) {
        const dicts = String(f.ref.dict).split(',').map((x) => x.trim()).filter(Boolean);
        refOpts[f.key] = (await Promise.all(dicts.map((d) => api('/dicts/' + d).catch(() => null).then((x) => (x?.items || []).filter((c) => c.code).map((c) => ({ code: String(c.code), name: c.name, group: dicts.length > 1 ? x?.dict?.title || d : '' })))))).flat();
      }
      const isNew = !r?.id;
      // productGroups (новая запись): список существующих для предупреждения о дублях по имени и номеру
      const pgItems = isNew && key === 'productGroups'
        ? await api('/dicts/productGroups').then((x) => x.items).catch(() => null)
        : null;
      // «Используется в: …» из /usage (сбой — без строки; правка при этом работает)
      const u = isNew ? null : await api(`/dicts/${key}/${r.id}/usage`).catch(() => null);
      const secs = (u?.sections || []).join(', ') || 'других разделах';
      const NAME_KEYS = ['name', 'firstName', 'lastName'];
      const usageField = isNew ? null : { key: '_usage', label: '', type: 'widget', wide: true, summary: () => '',
        widget: () => ({ el: h('div', null,
          u && u.tracked !== false ? h('div', { class: 'muted' }, u.busy ? `Используется в: ${secs}` : 'Нигде не используется') : null,
          canEditDict() ? button({ label: 'Объединить с…', size: 'S', onClick: () => mergeDialog(r, { close() {} }) }) : null),
        get value() { return ''; }, set value(x) { void x; }, focus() {} }) };
      // «Виды работ» сотрудника — несколько, галочками (workTypeIds; от них зависит, кого предложат на карточку в «В работе»)
      const wtOpts = (info.refs?.worktypes || []).map((o) => ({ code: String(o.value), name: o.label }));
      const one = (f) => (key === 'persons' && f.key === 'workTypeId' ? { key: 'workTypeIds', label: 'Виды работ', type: 'widget', wide: true, hint: 'Можно несколько. Только такие люди видны в Ганте и получают шаги этих работ.', summary: () => '',
        widget: (v) => refChipsField(wtOpts, { label: 'Виды работ', value: v, multiple: true }) }
        : f === catField && catOpts.length ? (() => {
          const strict = key === 'passportParts' || key === 'passportElements';
          const label = key === 'passportParts' ? 'В коротком списке у типов'
            : key === 'passportElements' ? 'Кому предлагают (обязательно)'
              : 'Кому предлагают';
          const hint = key === 'passportParts'
            ? 'Отметьте типы, где часть сразу в таблице. Чип «Только через „Показать все“» — в короткий список ни одного типа не попадёт.'
            : key === 'passportElements'
              ? 'Без отмеченных типов элемент никому не предложат («Что это за изделие»). Чип «Пока никому» = пусто в базе.'
              : 'Отметьте типы паспорта, где запись в выпадающем списке изделия. «Для всех типов» — любому типу.';
          const chips = strict
            ? { allLabel: key === 'passportElements' ? 'Пока никому' : 'Только через «Показать все»', emptyMeans: key === 'passportElements' ? 'не предложат ни одному типу' : 'не в коротком списке' }
            : { allLabel: 'Для всех типов', emptyMeans: 'любому типу паспорта' };
          return { key: f.key, label, type: 'widget', wide: true, hint, summary: () => '',
            widget: (v) => catChipsField(catOpts, { label, value: v, later: ['DIO', 'DSP'], ...chips }) };
        })()
        : key === 'passportKinds' && f.key === 'elementIds' ? { key: f.key, label: f.label, type: 'widget', wide: true, hint: f.hint, summary: () => '',
          widget: (v) => passportKindElements(info.refs?.[f.ref] || [], v, f.label) }
        : f.ref?.dict || f.multi ? { key: f.key, label: f.label, type: 'widget', wide: true, hint: f.hint, summary: () => '',
          widget: (v) => refChipsField(f.multi ? (info.refs?.[f.ref] || []).map((o) => ({ code: String(o.value), name: o.label })) : refOpts[f.key] || [], { label: f.label, value: v, multiple: f.multi || f.ref.multiple !== false }),
          mount: key === 'expenseArticles' && f.key === 'categoryIds' ? (fapi) => {
            const sync = () => { const field = fapi.field(f.key); if (field) field.hidden = !fapi.get('parentId'); };
            fapi.on('parentId', sync);
            sync();
          } : undefined }
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
        ...(f.key === 'requiredImages' ? { widget: (v) => tagPick({ options: kindOptions(v), value: linesToKinds(v), label: f.label }), hint: 'Отметьте рисунки, без которых паспорт этого типа не выдаётся' } : {}),
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
    toBody: (v) => FINANCIAL_KEYS.has(dictKey()) ? financialArticleBody(v) : Object.fromEntries(Object.entries(v).filter(([k, x]) => !k.startsWith('_') && !(k === 'code' && (x === '' || x == null))).map(([k, x]) => [k, k === 'workTypeIds' ? String(x || '').split(',').map((t) => t.trim()).filter(Boolean) : k === 'requiredImages' ? (Array.isArray(x) ? x.map((kind) => (kind === 'assembly' ? 'assembly (если разборное)' : kind)).join('\n') : '') : photoKeys.get(k) === 'photo' ? (Array.isArray(x) ? x[0] || '' : '') : x === null || x === undefined ? (photoKeys.has(k) ? [] : '') : x])),
    create: (b) => FINANCIAL_KEYS.has(dictKey()) ? financialDictWrite(dictKey(), null, 'create', b) : api(`/dicts/${dictKey()}`, { method: 'POST', body: b }).then((r) => { lookups.reset?.(); return r; }),
    update: (id, b) => FINANCIAL_KEYS.has(dictKey()) ? financialDictWrite(dictKey(), { id }, 'update', b) : api(`/dicts/${dictKey()}/${id}`, { method: 'PATCH', body: b }).then((r) => { lookups.reset?.(); if (r?.moved > 0) toast('Название изменено везде'); return r; }),
  },
  remove: { noTrash: true, // значения справочников на экране «Корзина» не показываются: у каждого справочника свой адрес
    text: (r) => `Удалить «${r.name}» из справочника «${r.dictInfo?.title || ''}»?`,
    run: (r) => FINANCIAL_KEYS.has(dictKey()) ? financialDictWrite(dictKey(), r, 'remove') : api(`/dicts/${dictKey()}/${r.id}`, { method: 'DELETE' }).then(() => lookups.reset?.()),
    restore: (r) => FINANCIAL_KEYS.has(dictKey()) ? financialDictWrite(dictKey(), r, 'restore') : api(`/dicts/${dictKey()}/${r.id}/restore`, { method: 'POST' }).then(() => lookups.reset?.()),
  },
};
