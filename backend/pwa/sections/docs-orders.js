import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { go } from '../core/router.js';
import { modal } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { failBlock } from '../ui/busy.js';
import { statusOf, canEdit as canEditTexts } from './passports/common.js';
import { printDialog } from './passports/dialogs.js';

/*
 * Вкладка «По заказам» (ТИ-11): заказ → его паспорта, счётчик «готовы M из N», чип «Готов / Не готов / Доработать».
 * Данные — GET /passports/by-order. Статус меняется в окне (выбор + заметка для «Доработать»); в архиве статус не меняется.
 */
export const READINESS = {
  ready: { label: 'Готов', cls: 'ok', hint: 'Готов — можно отдавать заказчику' },
  notReady: { label: 'Не готов', cls: 'dim', hint: 'Не готов — ещё не проверен' },
  rework: { label: 'Доработать', cls: 'warn', hint: 'Доработать — нужна правка (причина указана в паспорте)' },
};

/** Статус готовности: нет поля — выпущенный «Готов», черновик «Не готов»; аннулированный — без статуса. */
export const readinessOf = (r) => (statusOf(r) === 'annulled' ? null : r.readiness || (statusOf(r) === 'draft' ? 'notReady' : 'ready'));

export const readinessChip = (r) => {
  const k = readinessOf(r);
  const s = READINESS[k];
  return s ? h('span', { class: 'badge ' + s.cls, title: k === 'rework' && r.reworkNote ? 'Доработать — ' + r.reworkNote : s.hint }, s.label) : h('span', { class: 'muted' }, 'аннулирован');
};

const canChange = () => session.canEdit && canEditTexts();

async function changeReadiness(p) {
  const cur = readinessOf(p) || 'ready';
  const sel = h('select', null, ...Object.entries(READINESS).map(([v, s]) => h('option', { value: v }, s.label)));
  sel.value = cur;
  const note = h('textarea', { rows: 3, maxlength: 500, placeholder: 'Что доработать (необязательно)' }, p.reworkNote || '');
  const noteBox = h('label', { class: 'field' }, h('span', null, 'Что доработать'), note);
  const sync = () => { noteBox.hidden = sel.value !== 'rework'; };
  sel.addEventListener('change', sync); sync();
  const body = h('div', { class: 'form-grid' },
    h('label', { class: 'field' }, h('span', null, `Паспорт ${p.passportNumber && !String(p.passportNumber).startsWith('draft-') ? '№ ' + p.passportNumber : '(черновик)'}`), sel), noteBox);
  return modal({
    title: 'Статус паспорта', body, okText: 'Сохранить',
    onOk: async () => {
      const b = { readiness: sel.value };
      if (sel.value === 'rework') b.reworkNote = note.value.trim();
      await api(`/passports/${p.id}`, { method: 'PATCH', body: b });
      return true;
    },
  });
}

export function mountOrdersTab(params, { onChanged } = {}) {
  let state = { readiness: params.readiness || '', search: params.search || '', page: 1 };
  let open = params.open ? String(params.open) : '';
  const limit = 20;
  const search = h('input', { type: 'search', placeholder: 'Поиск: № заказа, № договора, заказчик…', value: state.search, 'aria-label': 'Поиск' });
  const chips = h('div', { class: 'seg', role: 'group', 'aria-label': 'Статус паспортов' });
  const list = h('div', { class: 'do-list' });
  const pager = h('div', { class: 'do-pager' });
  const el = h('div', { class: 'do' }, h('div', { class: 'do-head' }, search, chips),
    h('div', { class: 'do-legend' }, ...Object.values(READINESS).map((x) => h('span', { class: 'do-leg' }, h('span', { class: 'badge ' + x.cls }, x.label), h('span', { class: 'muted' }, x.hint.split(' — ')[1]))),
      h('span', { class: 'muted' }, 'Новый паспорт: вкладка «Нужно сделать паспорт» или «Паспорта».')), list, pager);
  let timer = 0, seq = 0;

  const drawChips = () => chips.replaceChildren(...[['', 'Все'], ...Object.entries(READINESS).map(([k, s]) => [k, s.label])].map(([k, label]) =>
    h('button', { type: 'button', class: state.readiness === k ? 'active' : '', onclick: () => { state = { ...state, readiness: k, page: 1 }; load(); } }, label)));

  const numOf = (p) => (p.passportNumber && !String(p.passportNumber).startsWith('draft-') ? '№ ' + p.passportNumber : 'черновик');
  const hintOf = (p) => { const k = readinessOf(p); return k === 'rework' ? 'Доработать' + (p.reworkNote ? ' — ' + p.reworkNote : '') : k ? READINESS[k].hint : ''; };

  const row = (p) => h('li', { class: 'do-row' },
    h('a', { href: '#', class: 'do-name', onclick: (e) => { e.preventDefault(); go('docs', { tab: 'archive', of: 'passarchive', open: p.id }); } },
      p.name || p.modelName || p.productName || 'Паспорт', h('span', { class: 'muted' }, ' ' + numOf(p))),
    h('span', { class: 'do-state', title: hintOf(p) }, readinessChip(p),
      readinessOf(p) === 'rework' && p.reworkNote ? h('span', { class: 'muted do-note' }, p.reworkNote) : null),
    h('span', { class: 'do-acts' },
      canChange() && statusOf(p) !== 'annulled' ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { if (await changeReadiness(p)) { toast('Статус сохранён'); await load(); onChanged?.(); } } }, 'Статус…') : null,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => printDialog(p) }, 'PDF и печать…')));

  // подгруппы по категории; если сервер не прислал categories — одна общая
  const subgroups = (g) => {
    const cats = g.categories?.length ? g.categories : [{ category: '', categoryLabel: '', total: (g.items || []).length, items: g.items || [] }];
    return cats.map((c) => h('div', { class: 'do-cat' },
      cats.length > 1 || c.categoryLabel ? h('div', { class: 'do-cat-head' }, h('b', null, c.categoryLabel || 'Без категории'), h('span', { class: 'muted' }, ` · ${c.total ?? c.items.length}`)) : null,
      h('ul', { class: 'do-rows' }, ...(c.items || []).map(row))));
  };

  const group = (g) => {
    const key = g.orderId ? String(g.orderId) : g.orderNo ? 'no:' + g.orderNo : 'none'; // паспорт с номером заказа, но без связи — своя группа
    const isOpen = open === key;
    const pct = g.total ? Math.round((g.ready / g.total) * 100) : 0;
    const head = h('button', { type: 'button', class: 'do-group-head', 'aria-expanded': String(isOpen), onclick: () => { open = isOpen ? '' : key; paint(); } },
      h('span', { class: 'do-title' },
        h('b', null, g.orderId || g.orderNo ? `Заказ № ${g.orderNo || 'без номера'}` : 'Без заказа'),
        g.customerName ? h('span', { class: 'muted' }, ' · ' + g.customerName) : null),
      h('span', { class: 'do-big' }, h('b', null, `Готово ${g.ready} из ${g.total}`),
        h('span', { class: 'do-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(g.total), 'aria-valuenow': String(g.ready) }, h('i', { style: `width:${pct}%` }))),
      g.rework ? h('span', { class: 'badge warn', title: READINESS.rework.hint }, `доработать: ${g.rework}`) : null,
      g.notReady ? h('span', { class: 'badge dim', title: READINESS.notReady.hint }, `не готовы: ${g.notReady}`) : null);
    return h('section', { class: 'do-group' }, head,
      isOpen ? h('div', { class: 'do-body' }, h('div', { class: 'section-title' }, `Паспорта (${g.total})`), ...subgroups(g)) : null,
      isOpen && g.orderId ? h('div', { class: 'do-foot' }, h('a', { href: '#salesorders?open=' + g.orderId }, 'Открыть заказ →')) : null);
  };

  let data = null;
  function paint() {
    drawChips();
    const items = data?.items || [];
    list.replaceChildren(...(items.length ? items.map(group) : [h('p', { class: 'muted' },
      state.search || state.readiness ? 'Ничего не найдено — снимите фильтр или поиск.' : 'Паспортов к заказам ещё нет. Выпустите паспорт на вкладке «Нужно сделать паспорт» — он появится здесь.')]));
    const pages = Math.max(1, Math.ceil((data?.total || 0) / limit));
    pager.replaceChildren(...(pages > 1 ? [
      h('button', { class: 'btn btn-sm', type: 'button', disabled: state.page <= 1, onclick: () => { state.page--; load(); } }, '← Назад'),
      h('span', { class: 'muted' }, ` ${state.page} из ${pages} `),
      h('button', { class: 'btn btn-sm', type: 'button', disabled: state.page >= pages, onclick: () => { state.page++; load(); } }, 'Дальше →')] : []));
  }

  async function load() {
    const my = ++seq;
    list.classList.add('is-busy');
    try {
      const query = { page: state.page, limit, ...(state.readiness ? { readiness: state.readiness } : {}), ...(state.search ? { search: state.search } : {}) };
      const d = await api('/passports/by-order', { query });
      if (my !== seq) return;
      data = d; paint();
    } catch (e) {
      if (my !== seq) return;
      list.replaceChildren(failBlock(e, load)); toastError?.(e, 'загрузить паспорта по заказам');
    } finally { if (my === seq) list.classList.remove('is-busy'); }
  }

  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state = { ...state, search: search.value.trim(), page: 1 }; load(); }, 300); });
  drawChips(); load();

  return {
    el,
    reload: load,
    focusSearch: () => search.focus(),
    destroy: () => clearTimeout(timer),
    update: (p) => { if (p.open && String(p.open) !== open) { open = String(p.open); paint(); } },
  };
}
