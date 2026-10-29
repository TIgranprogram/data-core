import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, money, qty } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { matchBadge, openMatching } from './salesorders-matching.js';
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
  const allCb = h('input', { type: 'checkbox', class: 'ua-cb', 'aria-label': 'Выбрать все' });
  const body = h('div', { class: 'ua-list' });
  const info = h('span', { class: 'muted small' });
  const more = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', hidden: true }, 'Показать ещё');
  const sync = () => { allCb.checked = rows.length > 0 && rows.every((r) => picked.has(r.id)); onChange?.([...picked]); };
  const paint = () => {
    info.textContent = total ? `Показано ${qty(rows.length)} из ${qty(total)}` : '';
    more.hidden = rows.length >= total;
    if (!rows.length) { body.replaceChildren(h('p', { class: 'muted' }, q ? 'Ничего не найдено.' : EMPTY)); sync(); return; }
    body.replaceChildren(...rows.map((r) => {
      const cb = h('input', { type: 'checkbox', class: 'ua-cb', checked: picked.has(r.id), onchange: (e) => { if (e.target.checked) picked.add(r.id); else picked.delete(r.id); sync(); } });
      return h('label', { class: 'ua-row' }, cb,
        h('span', { class: 'ua-main' }, h('b', null, 'Договор ' + (r.orderNo || '—')), h('span', { class: 'muted' }, r.customer ? ' · ' + r.customer : '')),
        h('span', { class: 'ua-match' }, matchBadge(r), r.canAssign === false ? h('button', { class: 'btn btn-sm', type: 'button', title: 'Сопоставить позиции договора с изделиями', onclick: (e) => { e.preventDefault(); openMatching(patch, r.id); } }, 'Сопоставить') : null),
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
  return { el, rows: () => rows, ids: () => [...picked], reload: () => load(false), count: () => total };
}

/** Блок в окне переноса: ответ 400 «не все позиции сопоставлены» → понятный текст и «Перейти к сопоставлению». */
export function blockedBox() {
  const el = h('div', { class: 'ua-blocked', hidden: true });
  const show = (e) => {
    const list = e?.data?.unmatched;
    if (!list?.length) return false;
    const first = list[0];
    el.hidden = false;
    el.replaceChildren(h('p', null, 'Нельзя перенести: в договорах есть позиции без изделия. Сопоставьте их, потом повторите.'),
      h('ul', null, list.map((x) => h('li', null, `Договор ${x.orderNo || '—'}: не сопоставлено ${qty(x.unmatched)} из ${qty(x.lines)}`))),
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => { el.closest('form')?.querySelector('.modal-foot button[type=button]')?.click(); openMatching(patch, first.orderId); } }, 'Перейти к сопоставлению'));
    return true;
  };
  return { el, show };
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
  const blocked = blockedBox();
  return modal({
    title: `Перенести договоров: ${ids.length}`, okText: 'Перенести',
    body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Куда'), mode), noField, blocked.el),
    onOk: async () => {
      if (mode.value === 'old' && !no.value.trim()) throw new Error('Укажите № заказа');
      try { return await assignContracts(ids, mode.value === 'old' ? no.value.trim() : ''); } catch (e) { blocked.show(e); throw e; }
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
    const bad = (picker?.rows() || []).filter((r) => ids.includes(r.id) && r.canAssign === false);
    bar.replaceChildren(h('b', null, `Выбрано ${ids.length}`),
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: bad.length > 0, title: bad.length ? 'Сначала сопоставьте позиции договора с изделиями' : undefined, onclick: async () => { if (await chooseTarget(ids)) { reload?.(); picker?.reload(); } } }, 'В заказ…'),
      bad.length ? h('span', { class: 'muted small' }, `Не сопоставлены позиции в договорах: ${bad.length}.`) : null,
      bad.length ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openMatching(patch, bad[0].id) }, 'Сопоставить') : null);
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
  const blocked = blockedBox();
  return modal({
    title: `Добавить договоры в заказ № ${productionNo}`, okText: 'Добавить выбранные', wide: true,
    body: h('div', null, (picker = unassignedPicker()).el, blocked.el),
    onOk: async () => {
      const ids = picker.ids();
      if (!ids.length) throw new Error('Отметьте хотя бы один договор');
      let res;
      try { res = await api('/production-orders/assign', { method: 'POST', body: { contractIds: ids, productionNo } }); } catch (e) { blocked.show(e); throw e; }
      toast(`Договоры перенесены в заказ № ${res?.productionNo || productionNo}`);
      window.dispatchEvent(new CustomEvent('data-changed'));
      after?.(res);
      return res || true;
    },
  });
}
