import { h } from '../../core/dom.js';
import { mark } from './mark.js';

/**
 * Эталон «Полоса этапов» (stageBar) и «Значки шапки» (headStats).
 *
 * stageBar({ steps:[{ key, label, done?, current?, note? }], onPick?(key), label? })
 *   Тонкая сегментная полоса «как заряд батареи»: пройдено — закрашено, текущий — акцент, впереди — пусто.
 *   Под полосой одна строка: название текущего этапа (+ note). Полные названия — в title сегментов.
 *   С onPick сегмент — кнопка (подпись для экранного чтения: «Название, пройден/сейчас/впереди»).
 *
 * headStats([{ value, label, title? }])
 *   Маленькие значки справа в строке заголовка панели: цифра + короткая подпись. «—» и 0 — бледно.
 *   Подсказка по умолчанию — «Подпись: значение».
 */
export function stageBar({ steps = [], onPick, label = 'Этапы' } = {}) {
  const cur = steps.find((s) => s.current) || [...steps].reverse().find((s) => s.done) || steps[0];
  const segs = steps.map((s) => {
    const kind = s.current ? 'cur' : s.done ? 'done' : 'todo';
    const state = kind === 'done' ? 'пройден' : kind === 'cur' ? 'сейчас' : 'впереди';
    const full = `${s.label}${s.note ? ' · ' + s.note : ''} (${state})`;
    const attrs = { class: 'k-stg-in', title: full, ...(kind === 'cur' ? { 'aria-current': 'step' } : {}) };
    const node = onPick
      ? h('button', { ...attrs, type: 'button', 'aria-label': full, onclick: () => onPick(s.key) }, h('i', { class: 'k-stg-fill', 'aria-hidden': 'true' }))
      : h('span', { ...attrs, role: 'img', 'aria-label': full }, h('i', { class: 'k-stg-fill', 'aria-hidden': 'true' }));
    return h('li', { class: 'k-stg-seg ' + kind }, node);
  });
  const cap = cur ? [cur.label, cur.note ? ' · ' + cur.note : ''].join('') : '';
  const pos = cur ? `${steps.indexOf(cur) + 1}/${steps.length}` : '';
  return mark(h('div', { class: 'k-stg' },
    h('ol', { class: 'k-stg-bar', 'aria-label': label }, ...segs),
    h('div', { class: 'k-stg-cap' }, h('b', null, cap), h('span', { class: 'k-stg-pos' }, pos))), 'stageBar');
}

export function headStats(items = []) {
  const list = items.filter(Boolean).map(({ value, label, title }) => {
    const v = value == null || value === '' ? '—' : String(value);
    const empty = v === '—' || v === '0';
    return h('span', { class: 'k-hst' + (empty ? ' is-empty' : ''), title: title || `${label}: ${v}` },
      h('b', { class: 'num' }, v), h('span', null, label));
  });
  return mark(h('div', { class: 'k-hstats', role: 'group', 'aria-label': 'Сводка' }, ...list), 'headStats');
}
