import { h } from '../core/dom.js';

/**
 * Метки качества записи справочника: «пусто», «дубль · N» + фильтр «Все / Пустые / Дубли» (DESIGN §4).
 * Дубль — записи с одинаковым ключом (текст или название без регистра, ё, знаков). N — сколько их в группе.
 */
export const normKey = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Map id → N для записей, у которых keyOf совпал с другими (пустой ключ не считается дублем). */
export function dupeCounts(items, keyOf) {
  const groups = new Map();
  for (const it of items) { const k = normKey(keyOf(it)); if (!k) continue; (groups.get(k) || groups.set(k, []).get(k)).push(it.id); }
  const out = new Map();
  for (const ids of groups.values()) if (ids.length > 1) for (const id of ids) out.set(id, ids.length);
  return out;
}

/** Метки записи: [<span class="badge warn">пусто</span>, <span ...>дубль · 4</span>]. */
export function qualityBadges({ empty = false, dupe = 0, dupeHint = 'Такой же текст есть у других вариантов — объедините' } = {}) {
  return [empty ? h('span', { class: 'badge warn' }, 'пусто') : null, dupe > 1 ? h('span', { class: 'badge warn', title: dupeHint }, `дубль · ${dupe}`) : null].filter(Boolean);
}

/** Фильтр над таблицей/деревом: «Все · Пустые (n) · Дубли (n)»; value: 'all' | 'empty' | 'dupes'. */
export function qualityFilter({ value = 'all', counts, onChange }) {
  const opts = [['all', 'Все'], ...(counts.empty === undefined ? [] : [['empty', `Пустые · ${counts.empty}`]]), ['dupes', `Дубли · ${counts.dupes}`]];
  const btns = opts.map(([v, text]) => h('button', { type: 'button', role: 'radio', class: 'fseg-btn' + (v === value ? ' on' : ''), 'aria-checked': String(v === value), 'data-v': v,
    onclick: () => onChange(v) }, text));
  return h('div', { class: 'fseg q-filter', role: 'radiogroup', 'aria-label': 'Показать записи' }, btns);
}
