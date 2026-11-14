/**
 * Именованные блоки-эталоны (DESIGN §3.2, C118 W2). Общие для всех карточек объекта (заказ, изделие, паспорт, контрагент):
 * экран вставляет информацию только ими. Импорт — только из kit (screens → kit, не наоборот).
 *  infoCard          «Информационная карточка»   — что это, этап один раз, ключевые сведения группами (≤ 6 строк, остальное «Подробнее»)
 *  nextCard          «Функциональная карточка»   — «Что дальше» + одна главная кнопка
 *  warnCard          «Карточка предупреждения»   — проблема + кнопка «исправить» (живёт в ../warn-card.js, здесь реэкспорт)
 *  positionsTable    «Таблица позиций»           — строки объекта, группы-заголовки, клик по строке — одна панель
 *  boardCard         «Карточка доски»            — заголовок, строка контекста, бейдж-беда, срок; кнопка шага — в card.foot доски
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
 * Таблица позиций: positionsTable({ columns, groups: [{ head?, rows: [{ cells, onOpen?, title? } | <tr>], foot? }], empty? }).
 * head — узел-заголовок группы (договор, часть) на всю ширину; foot — узел под строками группы («+ Позиция»).
 * Одинаковые строки — один клик: onOpen каждой строки открывает одну и ту же панель позиции.
 */
export function positionsTable({ columns = [], groups = [], empty, label } = {}) {
  const n = columns.length;
  const wide = (node, cls) => h('tr', { class: cls || null }, h('td', { colspan: n }, node));
  const rows = groups.flatMap((g) => [
    g.head ? wide(g.head) : null,
    ...(g.rows || []).map((r) => (r instanceof Node ? r : { cells: r.cells, onClick: r.onOpen })),
    g.foot ? wide(g.foot) : null,
  ]).filter(Boolean);
  const hasRows = groups.some((g) => (g.rows || []).length);
  const el = table({ columns, rows: hasRows ? rows : [], empty, clickable: true, label });
  return mark(el, 'positionsTable');
}
