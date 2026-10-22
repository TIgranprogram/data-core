import { api, PREFIX, session } from '../core/api.js';
import { searchBox } from '../ui/searchbox.js';
import { h } from '../core/dom.js';
import { money, qty } from '../core/format.js';
import { current, go, patch } from '../core/router.js';
import { modal } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { lookups } from './lookups.js';
import { flag } from '../core/flags.js';
import { mountTexts, TEXTS_KEY } from './passport-texts.js';

/**
 * «Справочники» (TASKS СП.4–СП.8, DESIGN §4 «Справочники»): слева группы, справа компактная таблица выбранного
 * справочника. Клик по строке — раскрывается: где используется (позиции, заявки, сотрудники). «Открыть» —
 * карточка справа (правка, объединить дубль, удалить, история). Все выпадающие списки приложения берутся отсюда.
 * Адрес: #dicts?d=<справочник>; карточка — of=dict&open=<id> (справочник — из d).
 * d=ptexts — не справочник, а редактор «Паспорта → Разделы и тексты» (sections/passport-texts.js, только при флаге passports.v2).
 */
const dictKey = () => current().params.d || 'categories';
const fmt = (f, v, refs) => {
  if (v === undefined || v === null || v === '') return '';
  if (f?.type === 'money') return money(v);
  if (f?.type === 'select') return (f.options || refs?.[f.ref] || []).find((o) => String(o.value) === String(v))?.label || '';
  return String(v);
};

export function mountDicts(params) {
  let groups = [];
  let data = null;
  let q = '';
  const openRows = new Set();
  const nav = h('nav', { class: 'panel dict-nav', 'aria-label': 'Справочники' });
  const title = h('h3', null, '…');
  const hint = h('p', { class: 'hint dict-hint' });
  // общий поиск (ПО.3): пусто — весь справочник
  const sbx = searchBox({ placeholder: 'Найти в справочнике…', label: 'Поиск в справочнике', delay: 150, onSearch: (v) => { q = v.toLowerCase(); renderTable(); } });
  const search = sbx.el;
  const searchWrap = h('div', { class: 'search' }, search);
  let texts = null; // экран «Разделы и тексты» (создаётся при первом открытии)
  const addBtn = h('button', { type: 'button', class: 'btn btn-primary', hidden: !session.canEdit, onclick: () => patch({ of: 'dict', new: '1', open: undefined }) }, '+ Добавить');
  const candBtn = h('button', { type: 'button', class: 'btn', hidden: !session.canEdit, title: 'Значения, которые уже встречаются в заявках, на складе и в Google-таблице, но ещё не в справочнике', onclick: () => toggleCandidates() }, 'Найти в данных…');
  const cand = h('div', { class: 'dict-cand', hidden: true });
  const body = h('div', { class: 'dict-body' });
  const box = h('section', { class: 'panel dict-main' },
    h('header', { class: 'dict-head' }, h('div', { class: 'dict-titles' }, title, hint), h('div', { class: 'dict-tools' }, searchWrap, candBtn, addBtn)),
    cand, body);
  const el = h('div', { class: 'dicts' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Справочники'), h('div', { class: 'sub' }, 'Все выпадающие списки приложения — здесь: добавить, исправить, объединить дубли'))),
    h('div', { class: 'dict-layout' }, nav, box));

  function renderNav() {
    const cur = dictKey();
    nav.replaceChildren(...groups.flatMap((g) => [
      h('div', { class: 'dict-group' }, g.group),
      ...g.items.map((d) => h('a', { class: 'dict-link' + (d.key === cur ? ' active' : ''), href: '#dicts?d=' + d.key, onclick: (e) => { e.preventDefault(); go('dicts', { d: d.key }, { replace: true }); } },
        h('span', null, d.title), h('b', { class: 'num' }, qty(d.count)))),
      // группа «Паспорта» есть только при флаге passports.v2 — в ней же редактор текстов (БЗ-6 Э2d)
      g.group === 'Паспорта' ? h('a', { class: 'dict-link' + (cur === TEXTS_KEY ? ' active' : ''), href: '#dicts?d=' + TEXTS_KEY, onclick: (e) => { e.preventDefault(); go('dicts', { d: TEXTS_KEY }, { replace: true }); } },
        h('span', null, 'Разделы и тексты'), h('b', null, '→')) : null,
    ]).filter(Boolean), h('div', { class: 'dict-group' }, 'Контрагенты'), h('a', { class: 'dict-link', href: '#partners' }, h('span', null, 'Поставщики, заказчики, наши компании'), h('b', null, '→')));
  }

  function renderTable() {
    if (!data) return;
    const { dict } = data;
    const cols = dict.columns.filter((c) => !(c.key === 'salaryRate' && !session.canMoney));
    const fieldOf = (k) => dict.fields.find((f) => f.key === k);
    const rows = data.items.filter((x) => !q || Object.values(x).join(' ').toLowerCase().includes(q));
    if (!data.items.length) {
      body.replaceChildren(h('div', { class: 'state' }, h('p', null, 'Справочник пуст.'), session.canEdit ? h('p', { class: 'muted' }, '«+ Добавить» — вписать вручную, «Найти в данных…» — взять то, что уже встречается в заявках и таблице.') : null));
      return;
    }
    if (!rows.length) { body.replaceChildren(h('div', { class: 'state' }, `Ничего не найдено по «${sbx.input.value}».`)); return; }
    const tbody = h('tbody');
    for (const r of rows) {
      const isOpen = openRows.has(r.id);
      const tr = h('tr', { class: 'dict-row' + (isOpen ? ' open' : ''), tabindex: '0', onclick: (e) => { if (!e.target.closest('button')) toggle(r.id); }, onkeydown: (e) => { if (e.key === 'Enter') toggle(r.id); } },
        h('td', { class: 'dict-chev', 'aria-hidden': 'true' }, isOpen ? '▾' : '▸'),
        h('td', { class: 'clip' }, h('b', { title: r.name }, r.name)),
        ...cols.map((c) => h('td', { class: 'clip md-hide' + (c.key === 'hex' ? ' dict-color' : '') }, c.key === 'hex' && r.hex ? [h('i', { class: 'swatch', style: { background: r.hex } }), r.hex] : fmt(fieldOf(c.key), r[c.key], dict.refs) || (c.key === 'workTypeName' ? r.workTypeName : ''))),
        h('td', { class: 'num right' }, r.used ? h('span', { title: 'Где используется — раскройте строку' }, qty(r.used)) : h('span', { class: 'muted' }, '—')),
        h('td', { class: 'right' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => patch({ of: 'dict', open: r.id, new: undefined }) }, 'Открыть')));
      tbody.append(tr);
      if (isOpen) tbody.append(h('tr', { class: 'dict-more' }, h('td'), h('td', { colspan: cols.length + 3 }, relatedBox(r))));
    }
    body.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'list dict-table' },
      h('thead', null, h('tr', null, h('th', { class: 'dict-chev' }), h('th', null, 'Название'), ...cols.map((c) => h('th', { class: 'md-hide' }, c.label)), h('th', { class: 'right' }, 'Используется'), h('th'))),
      tbody)));
  }

  // Раскрытая строка: что связано (грузится по требованию, кэшируется)
  const relCache = new Map();
  function relatedBox(r) {
    const box = h('div', { class: 'dict-rel' }, h('span', { class: 'skel', style: { width: '40%' } }));
    const fill = (res) => {
      const rel = res.related || { items: [] };
      box.replaceChildren(...[
        rel.title ? h('div', { class: 'section-title' }, `${rel.title}: ${qty(rel.total)}`) : null,
        rel.items.length ? h('ul', { class: 'dict-rel-list' }, ...rel.items.map((x) => h('li', null, x.href ? h('a', { href: x.href }, x.label) : x.label, x.sub ? h('span', { class: 'muted' }, ' · ' + x.sub) : null)))
          : h('p', { class: 'muted' }, 'Пока нигде не используется — можно удалить или переименовать без последствий.'),
        rel.total > rel.items.length ? h('p', { class: 'muted' }, `…и ещё ${qty(rel.total - rel.items.length)}`) : null].filter(Boolean));
    };
    const key = dictKey() + ':' + r.id;
    if (relCache.has(key)) fill(relCache.get(key));
    else api(`/dicts/${dictKey()}/${r.id}`).then((res) => { relCache.set(key, res); fill(res); }).catch((e) => box.replaceChildren(h('p', { class: 'muted' }, 'Не загрузилось: ' + e.message)));
    return box;
  }
  function toggle(id) { if (openRows.has(id)) openRows.delete(id); else openRows.add(id); renderTable(); }

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
    } catch (e) { cand.replaceChildren(h('p', { class: 'muted' }, 'Не загрузилось: ' + e.message)); }
  }

  async function reloadTexts() {
    try {
      const [g, v2] = await Promise.all([api('/dicts'), flag('passports.v2')]);
      groups = v2 ? g.items : g.items.filter((x) => x.group !== 'Паспорта');
      title.textContent = 'Разделы и тексты'; hint.textContent = 'Тексты паспортов v2 по категориям: что общее для всех, что своё у категории и что его заменяет. Клик по пункту — правка справа.';
      searchWrap.hidden = true; candBtn.hidden = true; addBtn.hidden = true; cand.hidden = true;
      renderNav();
      if (!v2) { body.replaceChildren(h('div', { class: 'state' }, 'Паспорта v2 выключены (флаг passports.v2) — редактор текстов недоступен.')); return; }
      if (!texts) texts = mountTexts();
      if (!body.contains(texts.el)) body.replaceChildren(texts.el);
      await texts.reload();
    } catch (e) { body.replaceChildren(h('div', { class: 'state' }, 'Не загрузилось: ' + e.message)); }
  }

  async function reload() {
    if (dictKey() === TEXTS_KEY) return reloadTexts();
    searchWrap.hidden = false;
    try {
      const [g, d, v2] = await Promise.all([api('/dicts'), api(`/dicts/${dictKey()}`), flag('passports.v2')]);
      // группа «Паспорта» (БЗ-6) — только при включённом флаге passports.v2; по прямой ссылке открывается и без него
      groups = v2 ? g.items : g.items.filter((x) => x.group !== 'Паспорта'); data = d;
      editRoles = g.items.flatMap((x) => x.items).find((i) => i.key === d.dict.key)?.editRoles || null;
      addBtn.hidden = !canEditDict();
      relCache.clear();
      title.textContent = d.dict.title; hint.textContent = d.dict.hint;
      candBtn.hidden = !canEditDict() || ['colors', 'worktypes', 'payoutSchedules'].includes(d.dict.key);
      renderNav(); renderTable();
    } catch (e) { body.replaceChildren(h('div', { class: 'state' }, 'Не загрузилось: ' + e.message)); }
  }
  let shown = params.d;
  reload();
  return {
    el, reload,
    update: (p) => { if (p.d === TEXTS_KEY && shown === TEXTS_KEY) { texts?.update(); return; } if (p.d !== shown) { shown = p.d; openRows.clear(); q = ''; sbx.set('', true); cand.hidden = true; data = null; body.replaceChildren(h('div', { class: 'state' }, 'Загрузка…')); reload(); } },
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
      h('p', { class: 'hint' }, `Это то же самое, что другое значение (дубль, другое написание)? Всё, где используется «${r.name}» (${qty(r.used)}), перейдёт к выбранному, а «${r.name}» уйдёт в корзину.`),
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
  return editRoles.some((r) => (r === 'director' ? ['admin', 'director'] : [r]).includes(session.user?.role));
}

/** Поля-картинки справочника (photo — одна, photos — несколько; БЗ-6 Э9.7). */
const isPhoto = (f) => f.type === 'photo' || f.type === 'photos';
const idsOf = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String);
let photoKeys = new Map();
function photoStrip(r, f) {
  const ids = idsOf(r[f.key]).filter((id) => r.photos?.[id]);
  if (!ids.length) return '';
  return h('div', { class: 'pf-strip' }, ...ids.map((id) => h('a', { class: 'pf-item', href: PREFIX + r.photos[id].url, target: '_blank', rel: 'noopener', title: 'Открыть картинку', 'aria-label': `${f.label}: открыть картинку` },
    h('img', { src: PREFIX + (r.photos[id].thumb || r.photos[id].url), alt: f.label }))));
}

export const dict = {
  id: 'dict',
  canEdit: canEditDict,
  title: 'Справочники',
  entityType: 'DictItem',
  historyLabels: { 'dict.created': 'Добавлено', 'dict.updated': 'Изменено', 'dict.deleted': 'Удалено', 'dict.restored': 'Восстановлено', 'dict.merged': 'Объединено' },
  get: (id) => api(`/dicts/${dictKey()}/${id}`),
  card: {
    heading: (r) => r.name,
    subheading: (r) => r.dictInfo?.title || '',
    stats: (r) => [['Используется', r.used ? qty(r.used) : '—']],
    view: (r) => (r.dictInfo?.fields || []).filter((f) => !['name', 'firstName', 'lastName', 'patronymic'].includes(f.key) || r.dict === 'persons')
      .filter((f) => f.type !== 'money' || session.canMoney)
      .map((f) => [f.label, isPhoto(f) ? photoStrip(r, f) : f.type === 'color' && r[f.key] ? h('span', null, h('i', { class: 'swatch', style: { background: r[f.key] } }), ' ', r[f.key]) : fmt(f, r[f.key], r.dictInfo.refs)]),
    actions: (r) => [{ label: 'Объединить с…', run: (row, ctx) => mergeDialog(row, ctx) }],
    extra: (r) => {
      const rel = r.related || { items: [] };
      if (!rel.title) return null;
      // у сотрудника — ещё «Выдано со склада» (related.more, TASKS Л.3)
      const block = (b, empty) => [h('div', { class: 'section-title' }, `${b.title} (${qty(b.total)})`),
        b.items.length ? h('ul', { class: 'timeline' }, ...b.items.map((x) => h('li', null, x.href ? h('a', { href: x.href }, x.label) : x.label, x.sub ? h('span', { class: 'muted' }, ' · ' + x.sub) : null)))
          : h('p', { class: 'muted' }, empty)];
      return h('div', null, ...block(rel, 'Пока нигде не используется'), ...(rel.more || []).flatMap((b) => block(b, 'Пока ничего')));
    },
  },
  form: {
    // поля и списки выбора — с сервера (описание справочника), чтобы форма всегда совпадала с тем, что он хранит
    fields: async (r) => {
      const info = r?.dictInfo || (await api(`/dicts/${dictKey()}`)).dict;
      photoKeys = new Map(info.fields.filter(isPhoto).map((f) => [f.key, f.type]));
      return info.fields.map((f) => ({
        key: f.key, label: f.label, required: !!f.required, wide: !!f.wide, hint: f.hint, max: 300,
        type: isPhoto(f) ? 'photos' : f.type === 'money' ? 'money' : f.type === 'select' ? 'select' : f.type === 'textarea' ? 'textarea' : 'text',
        money: f.type === 'money',
        placeholder: f.type === 'color' ? '#2e7d32' : undefined,
        options: f.type === 'select' ? (f.options || info.refs?.[f.ref] || []) : undefined,
      }));
    },
    initial: () => (dictKey() === 'persons' ? { status: 'active' } : {}),
    // картинки (БЗ-6 Э9.7): в форме — загрузка/вставка как везде; в базе — id фото (photo — один, photos — список)
    toInitial: (r) => ({ ...r, ...Object.fromEntries((r.dictInfo?.fields || []).filter(isPhoto).map((f) => [f.key, idsOf(r[f.key]).map((id) => ({ id, url: r.photos?.[id]?.url, thumb: r.photos?.[id]?.thumb || r.photos?.[id]?.url }))])) }),
    toBody: (v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, photoKeys.get(k) === 'photo' ? (Array.isArray(x) ? x[0] || '' : '') : x === null || x === undefined ? (photoKeys.has(k) ? [] : '') : x])),
    create: (b) => api(`/dicts/${dictKey()}`, { method: 'POST', body: b }).then((r) => { lookups.reset?.(); return r; }),
    update: (id, b) => api(`/dicts/${dictKey()}/${id}`, { method: 'PATCH', body: b }).then((r) => { lookups.reset?.(); return r; }),
  },
  remove: {
    blocked: (r) => (r.used ? `«${r.name}» используется (${qty(r.used)}) — удалить нельзя. Если это дубль — «Объединить с…»: всё перейдёт к другому значению.` : null),
    text: (r) => `«${r.name}» из справочника «${r.dictInfo?.title || ''}».`,
    run: (r) => api(`/dicts/${dictKey()}/${r.id}`, { method: 'DELETE' }).then(() => lookups.reset?.()),
    restore: (r) => api(`/dicts/${dictKey()}/${r.id}/restore`, { method: 'POST' }).then(() => lookups.reset?.()),
  },
};
