import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { actions, section } from '../ui/kit/index.js';
import { busyBlock, failBlock } from '../ui/kit/busy.js';
import { positionsTable } from '../ui/kit/screens/blocks.js';
import { posPic } from '../ui/kit/pos-pic.js';
import { ourLine, seq } from './order-blocks.js';

/** Блок «Позиции» в окне договора: таблица позиций (вид заказа) и видимая «+ Позиция» (C131). */
export function contractLinesBlock(r, { canAdd, addLineBtn, openLine }) {
  const body = h('div', null, busyBlock('позиции договора', { cls: 'so-state' }));
  const paint = (lines) => {
    const live = lines.filter((l) => !l.cancelledAt);
    const hasPic = (l) => !!(l.photo && (l.photo.url || l.photo.thumb));
    const rows = live.map((l, i) => ({ onOpen: openLine(l), cells: [{ v: seq(l, i), cls: 'muted' }, posPic(hasPic(l) ? l.photo : null, hasPic(l) ? 'lg' : 'sm'),
      h('span', null, l.title, ourLine(l), l.color || l.notes ? h('div', { class: 'muted small' }, [l.color && 'Цвет: ' + l.color, l.notes].filter(Boolean).join(' · ')) : null),
      { v: `${qty(l.qty)} ${l.unit || ''}`, cls: 'num nowrap' }] }));
    body.replaceChildren(
      positionsTable({ columns: [{ label: '№' }, { label: '', phoneHide: true }, { label: 'Название' }, { label: 'Кол-во', num: true }], groups: [{ rows }], label: 'Позиции договора', empty: { title: 'В договоре позиций пока нет.', hint: canAdd(r) ? 'Нажмите «+ Позиция» — поля откроются справа.' : 'Менять позиции может администратор.' } }),
      canAdd(r) ? actions(addLineBtn(r)) : null);
  };
  const load = () => api(`/production-orders/${encodeURIComponent(r.productionNo || r.id)}`)
    .then((d) => paint(((d.orders || []).find((o) => String(o.id) === String(r.id)) || {}).lines || []))
    .catch((e) => body.replaceChildren(failBlock(e, load, { cls: 'so-state', text: 'Позиции договора не загрузились' })));
  load();
  return section({ title: 'Позиции', tone: 'main', open: true, body: [body] });
}
