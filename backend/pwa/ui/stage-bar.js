import { h } from '../core/dom.js';
import { STAGE } from '../sections/order-stage.js';

/**
 * Воронка заказа: Проектирование › Производство › Готово к отгрузке › Отгружен › Закрыт.
 * Пройденный шаг — «✓», текущий — «●» и жирный, будущий — номер и пунктир (не только цвет).
 * «Частично отгружен» — текущий шаг «Отгружен» с подписью «частично»; «Отменён» — отдельная плашка.
 * Шаг этап не меняет: onStep(key) открывает нужный блок заказа.
 */
export const FUNNEL = ['new', 'production', 'ready', 'shipped', 'closed'];

export function stageBar(row, { onStep } = {}) {
  const st = row?.stage || 'new';
  if (st === 'cancelled') return h('div', { class: 'stg-cancel', role: 'status' }, '✕ Отменён');
  const at = FUNNEL.indexOf(st === 'partly' ? 'shipped' : st);
  const steps = FUNNEL.map((key, i) => {
    const kind = i < at ? 'done' : i === at ? 'cur' : 'todo';
    const mark = kind === 'done' ? '✓' : kind === 'cur' ? '●' : String(i + 1);
    const inner = [h('span', { class: 'stg-mark', 'aria-hidden': 'true' }, mark), h('span', { class: 'stg-lbl' }, STAGE[key].label),
      kind === 'cur' && st === 'partly' ? h('span', { class: 'stg-sub' }, 'частично') : null];
    const state = kind === 'done' ? 'пройден' : kind === 'cur' ? 'сейчас' : 'впереди';
    const attrs = { class: 'stg-in', ...(kind === 'cur' ? { 'aria-current': 'step' } : {}) };
    const node = onStep
      ? h('button', { ...attrs, type: 'button', title: `${STAGE[key].label} (${state}) — открыть нужный блок`, onclick: () => onStep(key) }, ...inner)
      : h('span', { ...attrs, title: `${STAGE[key].label} (${state})` }, ...inner);
    return h('li', { class: 'stg-step ' + kind }, node);
  });
  return h('ol', { class: 'stg', 'aria-label': 'Этапы заказа' }, ...steps);
}
