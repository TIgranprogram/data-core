import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { modal } from '../ui/dialog.js';
import { calcWeight, weightCount } from '../ui/weight-count.js';

/*
 * ⚖ «По весу» в строке «Операций» (приход, пересчёт — TASKS НО.2): то же окно-компонент, что в карточке;
 * результат — штуки в строку, расчёт — в примечание этой строки (уходит в движение).
 */
const g = (n) => `${qty(n)} г`;

export function weighButton(it, mode, onDone) {
  if (!['in', 'count'].includes(mode) || String(it.unit || 'шт').toLowerCase() !== 'шт') return null;
  return h('button', { class: 'btn btn-icon btn-sm', type: 'button', tabindex: -1, title: 'Посчитать по весу', 'aria-label': 'По весу', onclick: async () => {
    const q = h('input', { inputmode: 'decimal' });
    const wc = weightCount({ qtyInput: q, unitWeightG: it.weightG, label: mode === 'count' ? 'Количество всего' : 'Количество', expectQty: mode === 'count' ? it.quantity : null });
    setTimeout(() => wc.el.querySelector('.wc-seg .fseg-btn:last-child')?.click(), 0); // сразу «по весу»
    const r = await modal({
      title: `По весу: ${it.name}`, okText: 'Взять количество',
      body: h('div', null, wc.el),
      onOk: async () => {
        const v = wc.get();
        if (!v.qty) throw new Error(v.errors?.[0] || 'Впишите вес');
        const w = v.byWeight; const c = calcWeight(w);
        const parts = [w.sampleCount ? `образец ${w.sampleCount} шт = ${g(w.sampleWeightG)}` : '', `партии ${w.batchesG.map((x) => qty(x)).join(' + ')}`, w.tareG ? `тара ${g(w.tareG)}` : ''].filter(Boolean);
        return { qty: c.count, note: `по весу: ${g(c.totalG)} ÷ ${g(c.unitWeightG)} = ${c.count} шт (${parts.join('; ')})` };
      },
    });
    if (r) onDone(r.qty, r.note);
  } }, '⚖');
}
