import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { qty } from '../../core/format.js';
import { busyBlock, failBlock } from '../../ui/kit/busy.js';
import { section, table, hint, textInput, stack } from '../../ui/kit/index.js';

/**
 * C057 Э3: «Что купить» для изделия — GET /products/:id/purchase-needs?qty=
 * Стоит во вкладке изделия «Техописание» (tabs.js), под листом материалов.
 */
export function purchaseNeedsBlock(row) {
  let qtyVal = 1;
  const slot = stack();
  const qtyField = textInput({
    label: 'Количество изделий', value: '1', inputmode: 'decimal',
    onInput: (v) => { const n = Number(String(v).replace(',', '.')); qtyVal = n > 0 ? n : 1; paint(); },
  });
  const root = stack(qtyField.el, slot);

  function paint() {
    slot.replaceChildren(busyBlock('что купить', { retry: paint }));
    api(`/products/${row.id}/purchase-needs`, { query: { qty: qtyVal } }).then((res) => {
      const items = res.items || [];
      const missing = res.missingBlank || [];
      const body = [];
      if (items.length) {
        body.push(table({
          columns: [
            { label: 'Позиция' }, { label: 'Вид' }, { label: 'Нужно', num: true },
            { label: 'Есть', num: true }, { label: 'Купить', num: true }, { label: 'Примечание' },
          ],
          rows: items.map((x) => ({
            cells: [
              x.name || '—', x.kind || '—',
              `${qty(x.need)}${x.unit ? ' ' + x.unit : ''}`,
              `${qty(x.have)}${x.unit ? ' ' + x.unit : ''}`,
              `${qty(x.buy)}${x.buyUnit || x.unit ? ' ' + (x.buyUnit || x.unit) : ''}`,
              [x.format, x.note].filter(Boolean).join(' · ') || '—',
            ],
          })),
        }));
      } else body.push(hint('По этому количеству покупать нечего — или состав ещё пуст.'));
      if (missing.length) {
        body.push(h('p', { class: 'muted' }, 'Нет размера заготовки:'));
        body.push(h('ul', null, ...missing.map((m) => h('li', null, m.name || m.article || m.id))));
      }
      slot.replaceChildren(section({ title: 'Что купить', tone: 'gold', count: items.length || undefined, body }));
    }).catch((e) => slot.replaceChildren(failBlock(e, paint, { text: 'Список «Что купить» не загрузился' })));
  }
  paint();
  return root;
}
