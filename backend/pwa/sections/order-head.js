import { h } from '../core/dom.js';
import { session } from '../core/api.js';
import { money, qty } from '../core/format.js';
import { headStats, stageBar as kitStageBar } from '../ui/kit/stage-bar.js';
import { STAGE } from './order-stage.js';

/**
 * Шапка панели заказа: значки справа от номера (kit headStats) и полоса этапов под заголовком (kit stageBar).
 * Воронка: Проектирование › Производство › Готово к отгрузке › Отгружен › Закрыт.
 * «Частично отгружен» — текущий «Отгружен» с пометкой «частично»; «Отменён» — отдельная плашка.
 * Шаг этап не меняет: onStep(key) открывает нужный блок заказа.
 */
export const FUNNEL = ['new', 'production', 'ready', 'shipped', 'closed'];

export function stageBar(row, { onStep } = {}) {
  const st = row?.stage || 'new';
  if (st === 'cancelled') return h('div', { class: 'stg-cancel', role: 'status' }, '✕ Отменён');
  const at = FUNNEL.indexOf(st === 'partly' ? 'shipped' : st);
  const steps = FUNNEL.map((key, i) => ({ key, label: STAGE[key].label, done: i < at, current: i === at, note: i === at && st === 'partly' ? 'частично' : '' }));
  return kitStageBar({ steps, onPick: onStep, label: 'Этапы заказа' });
}

/** В card заказа одной строкой: ...orderHead(openStep). */
export const orderHead = (onStep) => ({
  headStats: (r) => {
    const n = qty((r.orderNos || []).length);
    const sum = r.amount ? money(r.amount) : '—';
    const paid = r.paidAmount ? money(r.paidAmount) : '—';
    return headStats([
      { value: n, label: 'дог.', title: `Договоров: ${n}` },
      { value: qty(r.lineCount), label: 'поз.', title: `Позиций: ${qty(r.lineCount)}` },
      // пустые сумма и оплата не показываем — шум (приёмка дизайнера); есть — видны
      ...(session.canMoney ? [r.amount ? { value: sum, label: 'сумма', title: `Сумма: ${sum}` } : null, r.paidAmount ? { value: paid, label: 'оплачено', title: `Оплачено: ${paid}` } : null].filter(Boolean) : []),
    ]);
  },
  headStrip: (r) => stageBar(r, { onStep }),
});
