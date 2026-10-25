import { api, PREFIX, session } from '../core/api.js';
import { searchBox } from '../ui/searchbox.js';
import { h } from '../core/dom.js';
import { busyBlock, busyBtn, failBlock } from '../ui/busy.js';
import { money, qty } from '../core/format.js';
import { current, go, patch } from '../core/router.js';
import { confirmDlg, modal } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { lookups } from './lookups.js';
import { KINDS, KINDS_V2, kindName } from '../core/passport-kinds.js';
import { tagPick } from '../ui/tag-pick.js';
import { mountTexts, TEXTS_KEY } from './passport-texts.js';
import { mountTree, TREE_KEY } from './passport-tree.js';
import { catChipsField, refChipsField } from '../ui/cat-chips.js';
import { dupeCounts, qualityBadges, qualityFilter } from '../ui/quality.js';
import { normSearch, searchTokens } from '../core/facets.js';

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
  const nav = h('nav', { class: 'panel dict-nav', 'aria-label': 'Справочники' });
  const sel = h('select', { class: 'dict-sel', 'aria-label': 'Справочник', onchange: () => { const v = sel.value; if (v === '#partners') go('partners'); else go('dicts', { d: v }, { replace: true }); } });
  const title = h('h3', null, '…');
  const hint = h('p', { class: 'hint dict-hint' });
  // общий поиск (ПО.3): пусто — весь справочник
  const sbx = searchBox({ placeholder: 'Найти значение…', label: 'Поиск значения', delay: 150, onSearch: (v) => { q = v.toLowerCase(); renderTable(); } });
  const search = sbx.el;
  const searchWrap = h('div', { class: 'search' }, search);
  let texts = null; // экран «Общие разделы» (создаётся при первом открытии)
  let tree = null; // экран «Тексты паспорта» (дерево вариантов)
  let qf = 'all'; // фильтр качества таблицы: все / дубли
  const addBtn = h('button', { type: 'button', class: 'btn btn-primary', hidden: !session.canEdit, onclick: () => patch({ of: 'dict', new: '1', open: undefined }) }, '+ Добавить');
  const candBtn = h('button', { type: 'button', class: 'btn', hidden: !session.canEdit, title: 'Значения, которые уже встречаются в заявках, на складе и в Google-таблице, но ещё не в справочнике', onclick: () => toggleCandidates() }, 'Найти в данных…');
  const cand = h('div', { class: 'dict-cand', hidden: true });
  const body = h('div', { class: 'dict-body' });
  const box = h('section', { class: 'panel dict-main' },
    h('header', { class: 'dict-head' }, h('div', { class: 'dict-titles' }, title, hint), h('div', { class: 'dict-tools' }, searchWrap, candBtn, addBtn)),
    cand, body);
  const el = h('div', { class: 'dicts' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Справочники'), h('div', { class: 'sub' }, 'Здесь меняются значения выпадающих списков: добавить, исправить, удалить. Изменение сразу видно во всех разделах'))),
    h('div', { class: 'dict-layout' }, sel, nav, box));

  // Меню: серверные группы → 4 понятные + «Контрагенты»; «Документы» свёрнуты, пока не выбран справочник из неё
  function menuGroups() {
    const m = new Map();
    for (const g of groups) { const n = GROUP_NAME[g.group] || g.group; if (!m.has(n)) m.set(n, []); m.get(n).push(...g.items); }
    const rank = (n) => { const i = GROUP_ORDER.indexOf(n); return i < 0 ? 99 : i; };
    return [...m].map(([name, items]) => ({ name, items })).sort((a, b) => rank(a.name) - rank(b.name));
  }
  function renderNav() {
    const cur = dictKey();
    const gs = menuGroups();
    const link = (key, text, count) => h('a', { class: 'dict-link' + (key === cur ? ' active' : ''), href: '#dicts?d=' + key, onclick: (e) => { e.preventDefault(); go('dicts', { d: key }, { replace: true }); } },
      h('span', null, text), count === undefined ? null : h('b', { class: 'num' }, count === '→' ? '→' : qty(count)));
    nav.replaceChildren(...gs.flatMap((g) => {
      const pass = g.name === PASS_GROUP;
      const here = g.items.some((d) => d.key === cur) || (pass && cur === TEXTS_KEY);
      const folded = pass && !here && !openGroups.has(g.name);
      const head = pass
        ? h('button', { type: 'button', class: 'dict-group dict-group-toggle', 'aria-expanded': String(!folded), onclick: () => { if (openGroups.has(g.name)) openGroups.delete(g.name); else openGroups.add(g.name); renderNav(); } }, (folded ? '▸ ' : '▾ ') + g.name)
        : h('div', { class: 'dict-group' }, g.name);
      if (folded) return [head];
      return [head, ...g.items.map((d) => link(d.key, d.title, d.count)), pass ? link(TEXTS_KEY, 'Общие разделы (шаблон)', '→') : null];
    }).filter(Boolean), h('div', { class: 'dict-group' }, 'Контрагенты'), h('a', { class: 'dict-link', href: '#partners' }, h('span', null, 'Поставщики, заказчики, наши компании'), h('b', null, '→')));
    // телефон: один select вместо ленты ссылок
    sel.replaceChildren(...gs.map((g) => h('optgroup', { label: g.name }, ...g.items.map((d) => h('option', { value: d.key }, d.title)), g.name === PASS_GROUP ? h('option', { value: TEXTS_KEY }, 'Общие разделы (шаблон)') : null)),
      h('optgroup', { label: 'Контрагенты' }, h('option', { value: '#partners' }, 'Поставщики, заказчики, наши компании')));
    sel.value = cur;
  }

  function renderTable() {
    if (!data) return;
    const { dict } = data;
    const cols = dict.columns.filter((c) => !(c.key === 'salaryRate' && !session.canMoney));
    const fieldOf = (k) => dict.fields.find((f) => f.key === k);
    // слова в любом порядке, ё = е, M10 = М10 (как поиск на складе)
    const tk = searchTokens(q);
    // дубль — то же название У ТОГО ЖЕ материала (сортамент: «2» у листа и «2» у трубы — разные записи; 2026-10-25)
    const dup = dupeCounts(data.items, (x) => (x.material ? `${x.material}|${x.name}` : x.name));
    if (!dup.size) qf = 'all';
    const rows = data.items.filter((x) => (qf !== 'dupes' || dup.has(x.id)) && (!tk.length || ((s) => tk.every((w) => s.includes(w)))(normSearch(Object.values(x).filter((v) => typeof v !== 'object').join(' ')))));
    if (!data.items.length) {
      body.replaceChildren(h('div', { class: 'state' }, h('p', null, 'Здесь пока ничего нет.'), canEditDict() ? h('p', { class: 'muted' }, 'Нажмите «+ Добавить» или «Найти в данных…» — возьмём то, что уже встречается в заявках и на складе.') : null));
      return;
    }
    if (!rows.length) { body.replaceChildren(h('div', { class: 'state' }, h('p', null, `Ничего не найдено по «${sbx.input.value}».`), h('p', { class: 'muted' }, 'Попробуйте другое слово.'))); return; }
    const descOf = (r) => cols.filter((c) => c.key !== 'name').map((c) => (c.key === 'hex' && r.hex ? [h('i', { class: 'swatch', style: { background: r.hex } }), r.hex] : fmt(fieldOf(c.key), r[c.key], dict.refs) || (c.key === 'workTypeName' ? r.workTypeName : '')))
      .filter((x) => x && x.length !== 0).flatMap((x, i) => (i ? [' · ', x] : [x]));
    const list = h('ul', { class: 'dict-list' });
    for (const r of rows) {
      const lock = isLocked(dict, r);
      const acts = [];
      if (canEditDict()) {
        acts.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => patch({ of: 'dict', open: r.id, new: undefined }) }, 'Изменить'));
        acts.push(lock ? h('span', { class: 'dict-lock muted', title: 'Это значение нужно программе — удалить нельзя' }, '🔒 Встроено в программу')
          : h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: (e) => removeItem(r, e.currentTarget) }, 'Удалить'));
      } else if (lock) acts.push(h('span', { class: 'dict-lock muted' }, '🔒 Встроено в программу'));
      list.append(h('li', { class: 'dict-item' },
        h('div', { class: 'dict-name' }, h('b', { title: r.name }, r.name), ...qualityBadges({ dupe: dup.get(r.id) || 0, dupeHint: 'Такое же название есть у другой записи — объедините' })),
        h('div', { class: 'dict-desc muted md-hide' }, ...descOf(r)),
        h('div', { class: 'dict-acts' }, ...acts)));
    }
    body.replaceChildren(...(dup.size ? [h('div', { class: 'pt-bar' }, qualityFilter({ value: qf, counts: { dupes: dup.size }, onChange: (v) => { qf = v; renderTable(); } }))] : []), list);
  }

  // Удаление из списка: свободное — подтверждение; занятое — замена (только админ), иначе текст
  async function removeItem(r, btn) {
    const key = dictKey();
    const fin = busyBtn(btn, null, { delay: 250 });
    let u;
    try { u = await api(`/dicts/${key}/${r.id}/usage`); } catch (e) { fin(); toastError(e, 'Удалить'); return; }
    fin();
    if (!u.tracked || !u.busy) {
      if (!(await confirmDlg(`Удалить «${r.name}»?`, 'Значение уйдёт в корзину. Вернуть можно из корзины.', { okText: 'Удалить', danger: true }))) return;
      try {
        await api(`/dicts/${key}/${r.id}`, { method: 'DELETE' });
        lookups.reset?.();
        toast('Значение удалено', { undo: async () => { try { await api(`/dicts/${key}/${r.id}/restore`, { method: 'POST' }); lookups.reset?.(); toast('Восстановлено'); await reload(); } catch (e) { toastError(e); } } });
        await reload();
      } catch (e) { toastError(e, 'Удалить'); }
      return;
    }
    const where = (u.sections || []).length ? u.sections.join(', ') : 'других разделах';
    const admin = isAdmin();
    const others = (data?.items || []).filter((x) => x.id !== r.id);
    const pick = h('select', { 'aria-label': 'Заменить на' }, h('option', { value: '' }, '— выберите значение —'), ...others.map((x) => h('option', { value: x.id }, x.name)));
    let rename = false;
    const renBtn = h('button', { type: 'button', class: 'btn', onclick: (e) => { rename = true; e.currentTarget.form.requestSubmit(); } }, 'Только переименовать');
    const res = modal({
      title: `«${r.name}» используется`,
      okText: 'Заменить и удалить',
      body: h('div', null,
        h('p', null, `Используется в: ${where}.` + (admin ? ` Чтобы удалить, выберите, чем заменить: везде, где стоит «${r.name}», появится новое значение.` : '')),
        admin ? h('label', { class: 'field' }, h('span', null, 'Заменить на'), pick, h('div', { class: 'warn' }, 'Это нельзя отменить кнопкой')) : h('p', { class: 'muted' }, 'Удаление занятого значения доступно администратору'),
        h('div', null, renBtn)),
      onOk: async () => {
        if (rename) return { rename: true };
        if (!pick.value) throw new Error('Выберите, чем заменить');
        return api(`/dicts/${key}/${r.id}/merge`, { method: 'POST', body: { intoId: pick.value } });
      },
    });
    const okB = [...document.querySelectorAll('.modal-foot .btn-primary')].pop();
    if (okB) { okB.hidden = !admin; okB.disabled = true; pick.addEventListener('change', () => { okB.disabled = !pick.value; }); }
    const done = await res;
    if (!done) return;
    if (done.rename) { patch({ of: 'dict', open: r.id, new: undefined }); return; }
    lookups.reset?.();
    toast(`Заменено: обновлено записей — ${qty(done.moved || 0)}`);
    window.dispatchEvent(new CustomEvent('data-changed'));
    await reload();
  }

  // «Найти в данных…» (СП.6): значения из заявок / склада / Google-таблицы, которых нет в справочнике — отметить и добавить
  async function toggleCandidates(force) {
    if (!cand.hidden && !force) { cand.hidden = true; return; }
    cand.hidden = false;
    cand.replaceChildren(h('p', { class: 'muted' }, 'Ищу в заявках, на складе и в Google-таблице…'));
    try {
      const r = await api(`/dicts/${dictKey()}/candidates`);
      if (!r.items.length) { cand.replaceChildren(h('p', { class: 'hint' }, 'Всё, что встречается в данных, уже есть в справочнике.'), h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { cand.hidden = true; } }, 'Закрыть')); return; }
      const boxes = r.items.map((c) => ({ c, cb: h('input', { type: 'checkbox', checked: !c.similar }) }));
      const go2 = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, 'Добавить отмеченные');
      go2.addEventListener('click', async () => {
        const names = boxes.filter((b) => b.cb.checked).map((b) => b.c.name);
        if (!names.length) { toast('Отметьте, что добавить', { error: true }); return; }
        go2.disabled = true; go2.textContent = 'Добавляю…';
        try { const res = await api(`/dicts/${dictKey()}/import`, { method: 'POST', body: { names } }); toast(`Добавлено: ${res.added}`); cand.hidden = true; lookups.reset?.(); await reload(); }
        catch (e) { toastError(e); go2.disabled = false; go2.textContent = 'Добавить отмеченные'; }
      });
      cand.replaceChildren(
        h('div', { class: 'section-title' }, `Нашлось в данных, но нет в справочнике: ${r.items.length}`),
        h('p', { class: 'hint' }, 'Отмечено то, чего точно нет. «Похоже на …» — вероятно, то же самое другим написанием: такое лучше не добавлять, а потом объединить.'),
        h('ul', { class: 'dict-cand-list' }, ...boxes.map(({ c, cb }) => h('li', null, h('label', null, cb, h('b', null, c.name)),
          h('span', { class: 'muted' }, [c.uses ? `встречается ${qty(c.uses)} раз` : '', c.source].filter(Boolean).join(' · ')),
          c.similar ? h('span', { class: 'tag' }, `похоже на «${c.similar.name}» ${Math.round(c.similar.score * 100)}%`) : null))),
        h('div', { class: 'bulk-foot' }, go2, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { cand.hidden = true; } }, 'Закрыть')));
    } catch (e) { cand.replaceChildren(failBlock(e)); }
  }

  async function reloadTree() {
    try {
      const g = await api('/dicts');
      groups = g.items;
      title.textContent = 'Тексты паспорта'; hint.textContent = 'Что подставляется в паспорт: раздел → 2–3 варианта → текст. Менеджер выбирает вариант, а не пишет текст.';
      searchWrap.hidden = true; candBtn.hidden = true; addBtn.hidden = true; cand.hidden = true;
      renderNav();
      if (!tree) tree = mountTree();
      if (!body.contains(tree.el)) body.replaceChildren(tree.el);
      await tree.reload();
    } catch (e) { body.replaceChildren(failBlock(e, () => reloadTree())); }
  }

  async function reloadTexts() {
    try {
      const g = await api('/dicts');
      groups = g.items;
      title.textContent = 'Общие разделы паспорта'; hint.textContent = 'Шаблон разделов по категориям (общие указания, хранение, гарантия…): что общее для всех, что своё у категории и что его заменяет. Клик по пункту — правка справа.';
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
      hint.textContent = d.dict.sections?.length ? `Применяется в: ${d.dict.sections.join(', ')}` : d.dict.hint || '';
      candBtn.hidden = !canEditDict() || ['colors', 'worktypes', 'payoutSchedules'].includes(d.dict.key);
      renderNav(); renderTable();
    } catch (e) { body.replaceChildren(failBlock(e, () => reload())); }
  }
  let shown = params.d;
  reload();
  return {
    el, reload,
    update: (p) => { if (p.d === TEXTS_KEY && shown === TEXTS_KEY) { texts?.update(); return; } if (p.d === TREE_KEY && shown === TREE_KEY) { tree?.update(); return; } if (p.d !== shown) { shown = p.d; q = ''; qf = 'all'; sbx.set('', true); cand.hidden = true; data = null; body.replaceChildren(busyBlock('справочник', { retry: () => reload() })); reload(); } },
  };
}

/** Объединить дубль: всё связанное перейдёт к выбранному, этот — в корзину. */
async function mergeDialog(r, ctx) {
  const all = (await api(`/dicts/${dictKey()}`)).items.filter((x) => x.id !== r.id);
  const sel = h('select', null, h('option', { value: '' }, '— выберите —'), ...all.map((x) => h('option', { value: x.id }, x.name)));
  const done = await modal({
    title: 'Объединить «' + r.name + '»',
    okText: 'Объединить',
    body: h('div', null,
      h('p', { class: 'hint' }, `Это то же самое, что другое значение (дубль, другое написание)? Всё, где используется «${r.name}», перейдёт к выбранному, а «${r.name}» уйдёт в корзину.`),
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
  return h('div', { class: 'pf-strip' }, ...ids.map((id) => h('a', { class: 'pf-item', href: PREFIX + r.photos[id].url, target: '_blank', rel: 'noopener', title: 'Открыть картинку', 'aria-label': `${f.label}: открыть картинку` },
    h('img', { src: PREFIX + (r.photos[id].thumb || r.photos[id].url), alt: f.label }))));
}

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
      .map((f) => [f.label, isPhoto(f) ? photoStrip(r, f) : f.type === 'color' && r[f.key] ? h('span', null, h('i', { class: 'swatch', style: { background: r[f.key] } }), ' ', r[f.key]) : fmt(f, r[f.key], r.dictInfo.refs)]),
    actions: (r) => [{ label: 'Объединить с…', run: (row, ctx) => mergeDialog(row, ctx) }],
  },
  form: {
    // поля и списки выбора — с сервера (описание справочника), чтобы форма всегда совпадала с тем, что он хранит
    fields: async (r) => {
      const info = r?.dictInfo || (await api(`/dicts/${dictKey()}`)).dict;
      photoKeys = new Map(info.fields.filter(isPhoto).map((f) => [f.key, f.type]));
      // «К каким категориям» — галочками-чипами (общий кусочек ui/cat-chips.js), а не строкой кодов «TRN, WRK»
      const catField = info.fields.find((f) => f.key === 'categories' && dictKey() !== 'passportCategories');
      const catOpts = catField ? (await api('/dicts/passportCategories').then((x) => x.items || []).catch(() => [])).filter((c) => c.code && c.code !== 'ALL').map((c) => ({ code: String(c.code), name: c.name })) : [];
      // выбор из справочника вместо строки кодов (ref: { dict, multiple }) — списки грузим один раз на форму
      const refOpts = {};
      for (const f of info.fields.filter((x) => x.ref?.dict)) {
        const dicts = String(f.ref.dict).split(',').map((x) => x.trim()).filter(Boolean);
        refOpts[f.key] = (await Promise.all(dicts.map((d) => api('/dicts/' + d).catch(() => null).then((x) => (x?.items || []).filter((c) => c.code).map((c) => ({ code: String(c.code), name: c.name, group: dicts.length > 1 ? x?.dict?.title || d : '' })))))).flat();
      }
      const isNew = !r?.id;
      // «Используется в: …» из /usage (сбой — без строки; правка при этом работает)
      const u = isNew ? null : await api(`/dicts/${dictKey()}/${r.id}/usage`).catch(() => null);
      const secs = (u?.sections || []).join(', ') || 'других разделах';
      const NAME_KEYS = ['name', 'firstName', 'lastName'];
      const usageField = isNew ? null : { key: '_usage', label: '', type: 'widget', wide: true, summary: () => '',
        widget: () => ({ el: h('div', { class: 'dict-usage' },
          u && u.tracked !== false ? h('div', { class: 'muted' }, u.busy ? `Используется в: ${secs}` : 'Нигде не используется') : null,
          canEditDict() ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => mergeDialog(r, { close() {} }) }, 'Объединить с…') : null),
        get value() { return ''; }, set value(x) { void x; }, focus() {} }) };
      const one = (f) => (f === catField && catOpts.length ? { key: f.key, label: f.label, type: 'widget', wide: true, hint: f.hint || '«Для всех» — подходит любой категории', summary: () => '',
        widget: (v) => catChipsField(catOpts, { label: f.label, value: v, later: ['DIO', 'DSP'] }) }
        : f.ref?.dict ? { key: f.key, label: f.label, type: 'widget', wide: true, hint: f.hint, summary: () => '',
          widget: (v) => refChipsField(refOpts[f.key] || [], { label: f.label, value: v, multiple: f.ref.multiple !== false }) }
        : f.lockAfterCreate && !isNew && (f.key === 'code' || r[f.key]) ? { key: f.key, label: f.label, type: 'widget', hint: f.key === 'code' ? 'Не меняется: на него ссылаются тексты и изделия' : 'Не меняется: ' + (f.hint || 'на него ссылаются изделия'), summary: () => '',
          widget: (v) => ({ el: h('span', { class: 'muted' }, String(v ?? '')), get value() { return JSON.stringify(String(v ?? '')); }, set value(x) { void x; }, focus() {} }) }
        : {
        key: f.key, label: !isNew && f.key === 'name' ? 'Новое значение' : f.label, required: !!f.required && !(f.key === 'code' && f.lockAfterCreate && isNew), wide: !!f.wide,
        ...(!isNew && NAME_KEYS.includes(f.key) && u?.busy ? { warn: (v) => (String(v ?? '').trim() && String(v).trim() !== String(r[f.key] ?? '') ? `Новое название сменится везде: ${secs}.` : null) } : {}),
        hint: f.key === 'code' && f.lockAfterCreate && isNew ? 'Заполнится само из названия' : f.hint, max: 300,
        ...(f.key === 'requiredImages' ? { widget: (v) => tagPick({ options: kindOptions(v), value: linesToKinds(v), label: f.label }), hint: 'Отметьте рисунки, без которых паспорт этой категории не выдаётся' } : {}),
        type: f.key === 'requiredImages' ? 'widget' : isPhoto(f) ? 'photos' : f.type === 'money' ? 'money' : f.type === 'select' ? 'select' : f.type === 'textarea' ? 'textarea' : 'text',
        money: f.type === 'money',
        placeholder: f.type === 'color' ? '#2e7d32' : undefined,
        options: f.type === 'select' ? (f.options || info.refs?.[f.ref] || []) : undefined,
      });
      // служебные поля (tech) — внизу, в свёрнутом блоке; остальные — сверху в порядке описания
      const main = [...(usageField ? [usageField] : []), ...info.fields.filter((f) => !f.tech).map(one)];
      const tech = info.fields.filter((f) => f.tech).map(one);
      return tech.length ? [...main, { section: 'Для настройки (менять редко)', tone: 'info', collapsed: true }, { note: 'Коды связывают записи между собой — меняйте, только если понимаете, на что они ссылаются' }, ...tech] : main;
    },
    initial: () => (dictKey() === 'persons' ? { status: 'active' } : {}),
    // картинки (БЗ-6 Э9.7): в форме — загрузка/вставка как везде; в базе — id фото (photo — один, photos — список)
    toInitial: (r) => ({ ...r, ...Object.fromEntries((r.dictInfo?.fields || []).filter(isPhoto).map((f) => [f.key, idsOf(r[f.key]).map((id) => ({ id, url: r.photos?.[id]?.url, thumb: r.photos?.[id]?.thumb || r.photos?.[id]?.url }))])) }),
    toBody: (v) => Object.fromEntries(Object.entries(v).filter(([k, x]) => !k.startsWith('_') && !(k === 'code' && (x === '' || x == null))).map(([k, x]) => [k, k === 'requiredImages' ? (Array.isArray(x) ? x.map((kind) => (kind === 'assembly' ? 'assembly (если разборное)' : kind)).join('\n') : '') : photoKeys.get(k) === 'photo' ? (Array.isArray(x) ? x[0] || '' : '') : x === null || x === undefined ? (photoKeys.has(k) ? [] : '') : x])),
    create: (b) => api(`/dicts/${dictKey()}`, { method: 'POST', body: b }).then((r) => { lookups.reset?.(); return r; }),
    update: (id, b) => api(`/dicts/${dictKey()}/${id}`, { method: 'PATCH', body: b }).then((r) => { lookups.reset?.(); if (r?.moved > 0) toast('Название изменено везде'); return r; }),
  },
  remove: {
    text: (r) => `«${r.name}» из справочника «${r.dictInfo?.title || ''}».`,
    run: (r) => api(`/dicts/${dictKey()}/${r.id}`, { method: 'DELETE' }).then(() => lookups.reset?.()),
    restore: (r) => api(`/dicts/${dictKey()}/${r.id}/restore`, { method: 'POST' }).then(() => lookups.reset?.()),
  },
};
