import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { modal } from '../ui/dialog.js';
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

/** Поля «Кому выдано»: { el, value() → { personId?, issuedTo? } }. */
export function issueToFields() {
  const sel = h('select', { 'aria-label': 'Кому выдано — сотрудник' }, h('option', { value: '' }, '— сотрудник —'));
  const txt = h('input', { maxlength: 200, placeholder: 'или: на объект, бригада', 'aria-label': 'Кому / куда выдано' });
  peopleByWork().then((groups) => {
    if (!groups.length) { sel.firstChild.textContent = '— сотрудников нет в «Справочниках» —'; return; }
    for (const g of groups) sel.append(h('optgroup', { label: g.group }, ...g.people.map((p) => h('option', { value: p.id }, p.name))));
    enhanceSelect(sel); // много людей — поиск по списку, ФИО целиком (ВС.6)
  }).catch(() => { sel.firstChild.textContent = '— список не загрузился —'; });
  const el = h('label', { class: 'field wide' }, h('span', null, 'Кому выдано'), h('div', { class: 'issue-to' }, sel, txt));
  return {
    el,
    value: () => ({ ...(sel.value ? { personId: sel.value } : {}), ...(txt.value.trim() ? { issuedTo: txt.value.trim() } : {}) }),
    reset: () => { sel.value = ''; txt.value = ''; },
  };
}

/**
 * Окно «Выдать по брони»: lines — [{ id, name, unit, qty }] (строки брони с остатком). Одна строка — можно выдать часть
 * (поле «Сколько»), несколько — выдаются целиком. Возвращает ответ сервера или null (отмена).
 */
export async function issueDialog(title, lines) {
  const one = lines.length === 1 ? lines[0] : null;
  const n = one ? h('input', { inputmode: 'decimal', value: String(one.qty) }) : null;
  const to = issueToFields();
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
