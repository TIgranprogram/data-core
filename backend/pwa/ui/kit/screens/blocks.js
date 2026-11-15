/**
 * Именованные блоки-эталоны (DESIGN §3.2, C118 W2). Общие для всех карточек объекта (заказ, изделие, паспорт, контрагент):
 * экран вставляет информацию только ими. Импорт — только из kit (screens → kit, не наоборот).
 *  infoCard          «Информационная карточка»   — что это, этап один раз, ключевые сведения группами (≤ 6 строк, остальное «Подробнее»)
 *  nextCard          «Функциональная карточка»   — «Что дальше» + одна главная кнопка
 *  warnCard          «Карточка предупреждения»   — проблема + кнопка «исправить» (живёт в ../warn-card.js, здесь реэкспорт)
 *  positionsTable    «Таблица позиций»           — строки объекта, группы-заголовки, клик по строке — одна панель
 *  boardCard         «Карточка доски»            — заголовок, строка контекста, бейдж-беда, срок; кнопка шага — в card.foot доски
 *  footerBar         «Подвал карточки»           — действия над всем объектом или отмеченными строками (C124: заказ)
 */
import { h } from '../../../core/dom.js';
import { mark } from '../mark.js';
import { readonlyGroup } from '../readonly.js';
import { section, stack, button, row as kitRow } from '../index.js';
import { table } from '../table.js';
import { busyBtn } from '../busy.js';
import { toastError } from '../toast.js';

export { warnCard } from '../warn-card.js';

/**
 * Информационная карточка: infoCard({ facts: [[подпись, значение]], more?: [[…]], max = 6 }) → узел со сведениями.
 * Пустые значения не показываются; лишнее сверх max и всё из `more` — в свёрнутом блоке «Подробнее».
 * «Что это» и этап (один раз) — в шапке панели: screenCard ({ title, sub, stage }).
 */
export function infoCard({ facts = [], more = [], max = 6 } = {}) {
  const shown = facts.filter(Boolean).filter(([, v]) => v !== null && v !== undefined && v !== '');
  const rest = [...shown.slice(max), ...more.filter(Boolean)];
  const main = readonlyGroup({ rows: shown.slice(0, max) });
  const extra = rest.length ? section({ title: 'Подробнее', tone: 'neutral', body: readonlyGroup({ rows: rest }) }) : null;
  return mark(h('div', { class: 'k-stack' }, ...[main, extra].filter(Boolean)), 'infoCard');
}

/**
 * Функциональная карточка: nextCard({ text, tone = 'neutral', primary: { label, title?, run, disabled? } | null }) → «Что дальше» и единственная главная кнопка.
 * run — async; пока идёт, кнопка занята; сбой — toastError. Нет primary — только фраза.
 */
export function nextCard({ text, tone = 'neutral', primary } = {}) {
  if (!text && !primary) return null;
  let btn = null;
  if (primary) {
    btn = button({ label: primary.label, kind: 'primary', size: 'S', title: primary.title, disabled: !!primary.disabled });
    btn.addEventListener('click', async () => {
      const done = busyBtn(btn, null, { delay: 250 });
      try { await primary.run(); } catch (e) { toastError(e, primary.label); } finally { done(); }
    });
  }
  return mark(kitRow({ tone, title: h('b', null, 'Что дальше'), meta: text || '', action: btn }), 'nextCard');
}

/**
 * Карточка доски (C118 W4): boardCard({ pic?, title, hint?, sub?, extra?, flags?, meta?, compact? }) → массив узлов для card.body доски.
 * Один порядок везде: фото → заголовок → одна строка контекста → extra (шаг, чек-лист) → бейджи-беды (flags) → срок/приоритет/исполнитель (meta).
 * Кнопка шага — не здесь, а в card.foot доски (одна кнопка). compact (колонка «Готово») — заголовок, контекст и срок в одном блоке.
 */
export function boardCard({ pic = null, title, hint, sub, extra = [], flags = [], meta = [], compact = false } = {}) {
  const t = h('div', { class: 't-title', title: hint || (typeof title === 'string' ? title : '') }, title);
  const s = sub ? h('div', { class: 't-sub' }, sub) : null;
  const fl = flags.filter(Boolean);
  const mt = meta.filter(Boolean);
  const flagRow = fl.length ? h('div', { class: 't-foot' }, ...fl) : null;
  const metaRow = mt.length ? h('div', { class: 't-foot' }, ...mt) : null;
  if (compact) return [pic, h('div', { class: 't-main' }, t, s, ...extra, flagRow, metaRow)].filter(Boolean);
  return [pic, t, s, ...extra, flagRow, metaRow].filter(Boolean);
}

/**
 * Таблица позиций: positionsTable({ columns, groups: [{ head?, rows: [{ cells, onOpen?, expand?() → узел, title? } | <tr>], foot? }], empty? }).
 * expand — клик раскрывает подробности под строкой (вместо onOpen).
 * head — узел-заголовок группы (договор, часть) на всю ширину; foot — узел под строками группы («+ Позиция»).
 * Одинаковые строки — один клик: onOpen каждой строки открывает одну и ту же панель позиции.
 */
export function positionsTable({ columns = [], groups = [], empty, label, pick } = {}) {
  // pick = { isOn(row), set(row, on) } — галочка в первой колонке (C124: отметить позиции для подвала); row.key — ключ строки
  if (pick) columns = [{ label: '', cls: 'k-pick-col' }, ...columns];
  const pickCell = (r) => {
    const cb = h('input', { type: 'checkbox', 'aria-label': 'Отметить позицию', checked: !!pick.isOn(r) });
    cb.addEventListener('change', () => { pick.set(r, cb.checked); cb.closest('tr')?.classList.toggle('is-picked', cb.checked); });
    return { v: h('label', { class: 'k-pick', title: 'Отметить' }, cb), cls: 'k-pick-col' };
  };
  const n = columns.length;
  const wide = (node, cls) => h('tr', { class: cls || null }, h('td', { colspan: n }, node));
  // expand — подробности строки раскрываются прямо под ней (владелец 15.11: вместо отдельной панели позиции); открыта одна
  function toggle(e, make) {
    if (e.target.closest('a, button, input, select, label')) return;
    const tr = e.currentTarget; const next = tr.nextElementSibling;
    const was = next?.classList.contains('k-pos-more');
    tr.closest('tbody')?.querySelectorAll('tr.k-pos-more').forEach((x) => { x.previousElementSibling?.classList.remove('selected'); x.remove(); });
    if (was) return;
    tr.classList.add('selected');
    tr.after(h('tr', { class: 'k-pos-more' }, h('td', { colspan: n }, make())));
  }
  const rows = groups.flatMap((g) => [
    g.head ? wide(g.head, 'k-pos-group') : null, // заголовок группы (договор) — по центру таблицы (владелец 15.11)
    ...(g.rows || []).map((r) => (r instanceof Node ? r : { cells: pick ? [r.key != null ? pickCell(r) : '', ...r.cells] : r.cells, onClick: r.expand ? (e) => toggle(e, r.expand) : r.onOpen })),
    g.foot ? wide(g.foot) : null,
  ]).filter(Boolean);
  const hasRows = groups.some((g) => (g.rows || []).length);
  const el = table({ columns, rows: hasRows ? rows : [], empty, clickable: true, label, cls: 'k-pos-table' });
  return mark(el, 'positionsTable');
}

/**
 * Подвал карточки (C124, владелец 15.11: «как верхушка — ничего лишнего; всё, что делается со всем заказом»).
 * footerBar({ total, noun: ['позиция','позиции','позиций'], groups: [{ label, items: [узлы-кнопки] | (picked) => узлы }], onClear })
 *   → { el, update(picked) } — picked: число отмеченных строк; 0 — «Весь заказ · N …», иначе «Отмечено K из N» и «Снять отметки».
 * Действия получают выбор сами (замыканием); подвал только показывает счёт и группы. Пустая группа не рисуется.
 */
export function footerBar({ title = 'Весь заказ', total = 0, noun = ['позиция', 'позиции', 'позиций'], groups = [], onClear } = {}) {
  const plural = (n) => noun[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2];
  const sum = h('div', { class: 'k-foot-sum' });
  const grp = h('div', { class: 'k-foot-groups' });
  const el = mark(h('div', { class: 'k-foot-bar', role: 'toolbar', 'aria-label': 'Действия со всем объектом' }, sum, grp), 'footerBar');
  function update(picked = 0) {
    const clear = picked && onClear ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: onClear }, 'Снять отметки') : null;
    sum.replaceChildren(h('b', null, picked ? `Отмечено ${picked} из ${total}` : title), h('span', { class: 'muted' }, picked ? '' : ` · ${total} ${plural(total)}`), clear);
    grp.replaceChildren(...groups.map((g) => {
      const items = (typeof g.items === 'function' ? g.items(picked) : g.items || []).filter(Boolean);
      return items.length ? h('div', { class: 'k-foot-grp' }, h('span', { class: 'k-foot-gl' }, g.label), ...items) : null;
    }).filter(Boolean));
  }
  update(0);
  return { el, update };
}
