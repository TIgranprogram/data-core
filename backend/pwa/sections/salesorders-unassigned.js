import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, money, qty } from '../core/format.js';
import { go } from '../core/router.js';
import { session } from '../core/api.js';
import { toast } from '../ui/toast.js';
import { modal } from '../ui/dialog.js';
import { attachCombo } from '../ui/combo.js';
import { errText } from '../ui/errors.js';

/** В3: «Договоры без заказа» — выбор галочками и перенос в новый или существующий заказ (POST /production-orders/assign). */

const LIMIT = 50;
const EMPTY = 'Все договоры уже в заказах';

/** Список договоров без заказа с поиском и галочками. onChange(ids) — при каждом изменении выбора. */
export function unassignedPicker({ onChange } = {}) {
  const picked = new Set();
  let rows = [];
  let total = 0;
  let q = '';
  const search = h('input', { type: 'search', placeholder: 'Поиск: № договора, заказчик…', 'aria-label': 'Поиск договоров' });
  const allCb = h('input', { type: 'checkbox', 'aria-label': 'Выбрать все' });
  const body = h('div', { class: 'ua-list' });
  const info = h('span', { class: 'muted small' });
  const more = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', hidden: true }, 'Показать ещё');
  const sync = () => { allCb.checked = rows.length > 0 && rows.every((r) => picked.has(r.id)); onChange?.([...picked]); };
  const paint = () => {
    info.textContent = total ? `Показано ${qty(rows.length)} из ${qty(total)}` : '';
    more.hidden = rows.length >= total;
    if (!rows.length) { body.replaceChildren(h('p', { class: 'muted' }, q ? 'Ничего не найдено.' : EMPTY)); sync(); return; }
    body.replaceChildren(...rows.map((r) => {
      const cb = h('input', { type: 'checkbox', checked: picked.has(r.id), onchange: (e) => { if (e.target.checked) picked.add(r.id); else picked.delete(r.id); sync(); } });
      return h('label', { class: 'ua-row' }, cb,
        h('span', { class: 'ua-main' }, h('b', null, 'Договор ' + (r.orderNo || '—')), h('span', { class: 'muted' }, r.customer ? ' · ' + r.customer : '')),
        h('span', { class: 'muted small nowrap' }, [r.date && date(r.date), `${qty(r.lineCount || 0)} поз.`, session.canMoney && r.amount ? money(r.amount) : ''].filter(Boolean).join(' · ')));
    }));
    sync();
  };
  const load = async (append) => {
    try {
      const d = await api('/production-orders/unassigned', { query: { q: q || undefined, page: append ? Math.floor(rows.length / LIMIT) + 1 : 1, limit: LIMIT } });
      rows = append ? rows.concat(d.items || []) : (d.items || []);
      total = d.total ?? rows.length;
      if (!append) for (const id of [...picked]) if (!rows.some((r) => r.id === id)) picked.delete(id);
      paint();
    } catch (e) { body.replaceChildren(h('p', { class: 'neg' }, errText(e))); }
  };
  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = search.value.trim(); load(false); }, 300); });
  allCb.addEventListener('change', () => { for (const r of rows) { if (allCb.checked) picked.add(r.id); else picked.delete(r.id); } paint(); });
  more.addEventListener('click', () => load(true));
  load(false);
  const el = h('div', { class: 'ua' }, search,
    h('div', { class: 'ua-head' }, h('label', { class: 'ua-all' }, allCb, ' Выбрать все'), info),
    body, more);
  return { el, ids: () => [...picked], reload: () => load(false), count: () => total };
}

/** Перенос: productionNo не задан — новый заказ; задан — в него. Тост и переход к заказу. */
export async function assignContracts(ids, productionNo) {
  const res = await api('/production-orders/assign', { method: 'POST', body: { contractIds: ids, ...(productionNo ? { productionNo } : {}) } });
  const no = res?.productionNo || productionNo || '';
  toast(`Договоры перенесены в заказ № ${no}`);
  window.dispatchEvent(new CustomEvent('data-changed'));
  if (no) go('salesorders', { open: no });
  return res;
}

/** «Куда перенести N договоров»: новый заказ или существующий (список с поиском). */
export async function chooseTarget(ids) {
  let nums = [];
  try { const d = await api('/production-orders', { query: { filter: 'active', limit: 200, sort: '-createdAt' } }); nums = [...new Set((d.items || []).map((x) => x.productionNo).filter(Boolean))]; } catch { /* список необязателен */ }
  const mode = h('select', { 'aria-label': 'Куда' }, h('option', { value: 'new' }, 'В новый заказ (номер выдаст система)'), h('option', { value: 'old' }, 'В существующий заказ'));
  const no = h('input', { placeholder: '№ заказа: начните вводить', autocomplete: 'off', 'aria-label': '№ заказа' });
  const noField = h('label', { class: 'field', hidden: true }, h('span', null, '№ заказа'), no);
  mode.addEventListener('change', () => { noField.hidden = mode.value !== 'old'; if (!noField.hidden) no.focus(); });
  attachCombo(no, { options: () => nums.map((n) => ({ value: n, label: '№ ' + n })), free: false, empty: 'Нет заказов в работе' });
  return modal({
    title: `Перенести договоров: ${ids.length}`, okText: 'Перенести',
    body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Куда'), mode), noField),
    onOk: async () => {
      if (mode.value === 'old' && !no.value.trim()) throw new Error('Укажите № заказа');
      return assignContracts(ids, mode.value === 'old' ? no.value.trim() : '');
    },
  });
}

/** Блок над списком «Заказов»: плашка «Договоры без заказа (N)» → раскрывается выбор с полосой действий. */
export function unassignedTop(reload) {
  const btn = h('button', { class: 'btn btn-ghost', type: 'button', 'aria-expanded': 'false' }, 'Договоры без заказа');
  const box = h('div', { class: 'ua-box', hidden: true });
  const el = h('div', { class: 'ua-top' }, btn, box);
  let picker = null;
  const setCount = (n) => { btn.textContent = `Договоры без заказа${n == null ? '' : ` (${qty(n)})`}`; btn.classList.toggle('active', !box.hidden); };
  api('/production-orders/unassigned', { query: { limit: 1 } }).then((d) => setCount(d.total ?? 0)).catch(() => {});
  const bar = h('div', { class: 'ua-bar', hidden: true });
  const onChange = (ids) => {
    bar.hidden = !ids.length;
    bar.replaceChildren(h('b', null, `Выбрано ${ids.length}`),
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => { if (await chooseTarget(ids)) { reload?.(); picker?.reload(); } } }, 'Перенести в заказ…'));
  };
  const open = () => {
    box.hidden = !box.hidden;
    btn.setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden && !picker) { picker = unassignedPicker({ onChange }); box.append(bar, picker.el); }
    if (!box.hidden) picker?.reload().then?.(() => setCount(picker.count()));
    setCount(picker ? picker.count() : null);
  };
  btn.addEventListener('click', open);
  window.addEventListener('data-changed', () => { if (!box.hidden) picker?.reload(); });
  return el;
}

/** Карточка заказа: «+ Добавить договор» — несколько договоров без заказа в этот заказ. */
export function addContractsDialog(productionNo, after) {
  let picker;
  return modal({
    title: `Добавить договоры в заказ № ${productionNo}`, okText: 'Добавить выбранные', wide: true,
    body: (picker = unassignedPicker()).el,
    onOk: async () => {
      const ids = picker.ids();
      if (!ids.length) throw new Error('Отметьте хотя бы один договор');
      const res = await api('/production-orders/assign', { method: 'POST', body: { contractIds: ids, productionNo } });
      toast(`Договоры перенесены в заказ № ${res?.productionNo || productionNo}`);
      window.dispatchEvent(new CustomEvent('data-changed'));
      after?.(res);
      return res || true;
    },
  });
}
