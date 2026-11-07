import { api, session } from '../core/api.js';
import { cachedFetch } from '../core/cache.js';
import { persons } from './passports/common.js';
import { ordersLookup } from '../core/orders-lookup.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { modal } from '../ui/kit/dialog.js';
import { attachCombo, funnel } from '../ui/kit/index.js';

/*
 * «Кому выдано» (TASKS Л.3) и «Выдать по брони» (Б.2) — общее для «Операций», строки «− Списать» и броней.
 * Сотрудники — только из «Справочников» (CANON §5): выбор «Вид работ → Человек» — один список с группами по видам работ;
 * не сотрудник (объект, бригада) — строкой текста рядом.
 */
/** Работающие сотрудники, сгруппированные по видам работ: [{ group, people: [{ id, name }] }]. */
export async function peopleByWork() {
  return cachedFetch('issue:peopleByWork', 60000, () => persons().then((r) => {
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
    }));
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

/** ВЫД.1: последний «Кому выдано» — на 2 часа в этой вкладке (память kit target-picker, режим «Выдать»). */
const LAST_KEY = 'dc-issue-to';
export const lastTo = () => { try { const v = JSON.parse(sessionStorage.getItem(LAST_KEY) || 'null'); return v && Date.now() - v.at < 2 * 3600e3 ? v : null; } catch { return null; } };
export const saveTo = (v) => { try { sessionStorage.setItem(LAST_KEY, JSON.stringify({ ...v, at: Date.now() })); } catch { /* приватный режим */ } };

/** C033: «Недавно выдавал» — свои прошлые выборы, в этом браузере (localStorage, не 2 часа). */
const RECENT_KEY = 'dc-issue-recent';
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') || []; } catch { return []; } };
const pushRecent = (v) => { if (!v.personId && !v.issuedTo) return; try { localStorage.setItem(RECENT_KEY, JSON.stringify([{ ...v }, ...readRecent().filter((x) => (x.personId || x.issuedTo) !== (v.personId || v.issuedTo))].slice(0, 6))); } catch { /* приватный режим */ } };

/** «Недавно выдавал» — мои последние выдачи из журнала (GET /stock/movements?type=out, существующий); пусто — из своих прошлых выборов.
 *  onPick получает { personName?, issuedTo? } / { personId, personName? } — клик по строке «Недавно». */
export async function recentIssues(onPick) {
  try {
    const r = await api('/stock/movements', { query: { type: 'out', limit: 50, sort: '-date' } });
    const me = session.name;
    const seen = new Set();
    const items = (r.items || []).filter((m) => !m.cancelledAt && (m.createdBy || '') === me)
      .map((m) => ({ personName: m.personName || '', issuedTo: m.issuedTo || '' }))
      .filter((x) => { const k = x.personName || x.issuedTo; if (!k || seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 4)
      .map((x) => ({ title: x.personName || x.issuedTo, meta: 'моя выдача', onClick: () => onPick(x) }));
    if (items.length) return items;
  } catch { /* журнал не открылся — память своих выборов ниже */ }
  return readRecent().slice(0, 4).map((v) => ({ title: v.personName || v.issuedTo, meta: 'прошлый выбор', onClick: () => onPick(v) }));
}

/**
 * Поля «Кому выдано» (C033, П-1 «Воронка с памятью»): шаги «Вид работ → Сотрудник» на эталоне funnel
 * (вид работ один — шаг пропущен сам), под ними — «или: объект / заказ» с заказами в работе.
 * { el, value() → { personId?, issuedTo? } }; issuedTo — подставить (объект брони).
 */
export function issueToFields(issuedTo = '') {
  let groups = []; let group = ''; let person = '';
  let personName = ''; // для «Недавно» — выбрать человека по имени, id придёт из справочника
  const txt = h('input', { maxlength: 200, value: issuedTo, placeholder: 'или: объект / заказ — из списка или своё', 'aria-label': 'Кому / куда выдано' });
  withOrders(txt);
  const apply = (x) => { // клик по «Недавно» — заполнить шаги/текст
    if (x?.personName) { personName = x.personName; group = groups.find((g) => g.people.some((p) => p.name === personName))?.group || group; const found = groups.flatMap((g) => g.people).find((p) => p.name === personName); person = found?.id || ''; txt.value = ''; }
    else if (x?.issuedTo) { txt.value = x.issuedTo; person = ''; personName = ''; }
    paint();
  };
  const fn = funnel({
    steps: [],
    onChange: (key, v) => { if (key === 'wt') { group = v; person = ''; } else if (key === 'person') person = v; paint(); },
    recent: [],
  });
  const paint = () => {
    const steps = [
      { key: 'wt', label: 'Вид работ', value: group, values: groups.map((g) => ({ id: g.group, label: g.group, count: g.people.length })) },
      { key: 'person', label: 'Сотрудник', value: person, values: (groups.find((g) => g.group === group)?.people || groups.flatMap((g) => g.people)).map((p) => ({ id: p.id, label: p.name })) },
    ];
    fn.update({ steps, next: person || txt.value.trim() ? null : undefined });
  };
  peopleByWork().then((gs) => { groups = gs; if (personName) apply({ personName }); else paint(); }).catch(() => paint());
  recentIssues(apply).then((items) => fn.setRecent(items));
  const el = h('div', { class: 'field wide' }, h('span', null, 'Кому выдано'), fn.el, h('div', null, txt));
  return {
    el,
    value: () => { const nm = groups.flatMap((g) => g.people).find((p) => p.id === person)?.name || personName; const v = { ...(person ? { personId: person } : {}), ...(txt.value.trim() ? { issuedTo: txt.value.trim() } : {}) }; pushRecent({ ...v, ...(nm ? { personName: nm } : {}) }); return v; },
    reset: () => { group = ''; person = ''; personName = ''; txt.value = ''; paint(); },
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
