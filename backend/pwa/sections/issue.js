import { api } from '../core/api.js';
import { ordersLookup } from '../core/orders-lookup.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { modal } from '../ui/dialog.js';
import { attachCombo } from '../ui/combo.js';
import { enhanceSelect } from '../ui/select.js';

/*
 * «Кому выдано» (TASKS Л.3) и «Выдать по брони» (Б.2) — общее для «Операций», строки «− Списать» и броней.
 * Сотрудники — только из «Справочников» (CANON §5): выбор «Вид работ → Человек» — один список с группами по видам работ;
 * не сотрудник (объект, бригада) — строкой текста рядом.
 */
let cache = null;
/** Работающие сотрудники, сгруппированные по видам работ: [{ group, people: [{ id, name }] }]. */
export async function peopleByWork() {
  if (!cache) {
    cache = api('/dicts/persons').then((r) => {
      const wt = new Map((r.dict?.refs?.worktypes || []).map((o) => [o.value, o.label]));
      const groups = new Map();
      for (const p of r.items || []) {
        if (p.status === 'fired') continue;
        const g = wt.get(p.workTypeId) || 'Без вида работ';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push({ id: p.id, name: p.name });
      }
      return [...groups.entries()].sort((a, b) => (a[0] === 'Без вида работ') - (b[0] === 'Без вида работ') || a[0].localeCompare(b[0], 'ru'))
        .map(([group, people]) => ({ group, people: people.sort((a, b) => a.name.localeCompare(b.name, 'ru')) }));
    }).catch((e) => { cache = null; throw e; });
  }
  return cache;
}

/**
 * Заказы в работе — для «на объект / под какой заказ» (замечание 2026-10-23: «на объект не даёт выпадающий список»):
 * [{ label: «№ 12 · Заказчик», sub: предмет }]. Список грузится один раз; можно вписать и своё.
 */
let ordersCache = null;
export const orderOptions = () => (ordersCache ??= ordersLookup({ filter: 'active' })
  .then((items) => items.map((o) => ({ label: [`№ ${o.orderNo || '—'}`, o.customer].filter(Boolean).join(' · '), sub: o.title || '' })))
  .catch(() => { ordersCache = null; return []; }));

/** Поле текста с выпадающим списком заказов в работе (вписать своё тоже можно). */
export function withOrders(input) {
  let opts = [];
  orderOptions().then((x) => { opts = x; });
  attachCombo(input, { options: () => opts });
  return input;
}

/** ВЫД.1: последний «Кому выдано» — на 2 часа в этой вкладке: следующая выдача подставляет его сама (выдают пачкой одному). */
const LAST_KEY = 'dc-issue-to';
const lastTo = () => { try { const v = JSON.parse(sessionStorage.getItem(LAST_KEY) || 'null'); return v && Date.now() - v.at < 2 * 3600e3 ? v : null; } catch { return null; } };
const saveTo = (v) => { try { sessionStorage.setItem(LAST_KEY, JSON.stringify({ ...v, at: Date.now() })); } catch { /* приватный режим */ } };

/** Поля «Кому выдано»: { el, value() → { personId?, issuedTo? } }; issuedTo — подставить (объект брони); пусто — последний выбор. */
export function issueToFields(issuedTo = '') {
  const last = issuedTo ? null : lastTo();
  if (last?.issuedTo) issuedTo = last.issuedTo;
  const sel = h('select', { 'aria-label': 'Кому выдано — сотрудник' }, h('option', { value: '' }, '— сотрудник —'));
  const txt = h('input', { maxlength: 200, value: issuedTo, placeholder: 'или: объект / заказ — из списка или своё', 'aria-label': 'Кому / куда выдано' });
  peopleByWork().then((groups) => {
    if (!groups.length) { sel.firstChild.textContent = '— сотрудников нет в «Справочниках» —'; return; }
    for (const g of groups) sel.append(h('optgroup', { label: g.group }, ...g.people.map((p) => h('option', { value: p.id }, p.name))));
    if (last?.personId) sel.value = last.personId;
    enhanceSelect(sel); // много людей — поиск по списку, ФИО целиком (ВС.6)
  }).catch(() => { sel.firstChild.textContent = '— список не загрузился —'; });
  const el = h('label', { class: 'field wide' }, h('span', null, 'Кому выдано'), h('div', { class: 'issue-to' }, sel, h('div', null, txt)));
  withOrders(txt);
  return {
    el,
    value: () => { const v = { ...(sel.value ? { personId: sel.value } : {}), ...(txt.value.trim() ? { issuedTo: txt.value.trim() } : {}) }; if (v.personId || v.issuedTo) saveTo(v); return v; },
    reset: () => { sel.value = ''; txt.value = ''; },
  };
}

/**
 * Окно «Выдать по брони»: lines — [{ id, name, unit, qty }] (строки брони с остатком). Одна строка — можно выдать часть
 * (поле «Сколько»), несколько — выдаются целиком. Возвращает ответ сервера или null (отмена).
 */
export async function issueDialog(title, lines, { issuedTo = '' } = {}) {
  const one = lines.length === 1 ? lines[0] : null;
  const n = one ? h('input', { inputmode: 'decimal', value: String(one.qty) }) : null;
  const to = issueToFields(issuedTo); // объект — из брони («под какой заказ»), можно поменять
  return modal({
    title, okText: 'Выдать',
    body: h('div', null,
      h('p', { class: 'hint' }, one ? `В брони: ${qty(one.qty)} ${one.unit}. Меньше — остаток брони останется.` : `Выдать целиком ${lines.length} позиций брони. Частично — кнопкой «выдать» в строке.`),
      h('div', { class: 'form-grid' }, one ? h('label', { class: 'field' }, h('span', null, `Сколько, ${one.unit}`), n) : null, to.el)),
    onOk: async () => {
      const k = one ? Number(String(n.value).replace(',', '.').replace(/\s/g, '')) : undefined;
      if (one && !(k > 0)) throw new Error('Введите, сколько выдать');
      if (one && k > one.qty) throw new Error(`В брони только ${qty(one.qty)} ${one.unit}`);
      return api('/stock/reservations/issue', { method: 'POST', body: { lines: lines.map((l) => ({ reservationId: l.id, ...(one ? { qty: k } : {}) })), ...to.value(), clientUid: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) } });
    },
  });
}
