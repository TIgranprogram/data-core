import { h } from '../core/dom.js';
import { ordersLookup } from '../core/orders-lookup.js';
import { busyBlock, failBlock, field, modal, select, stack, textInput } from '../ui/kit/index.js';
import { COST_CENTER } from '../ui/kit/badges.js';

const DIRECT_LABELS = { office: 'На офис', workshop: 'На цех', smr: COST_CENTER.smr };
export const lineOrder = (row) => row.orderLabel || `Заказ № ${row.productionNo || row.orderNo || '—'}`;
export const directReceiptLabel = (line) => [
  Object.hasOwn(DIRECT_LABELS, line.costCenter) ? DIRECT_LABELS[line.costCenter] : 'Получено напрямую', line.costObject,
].filter(Boolean).join(' · ');

function orderLabel(row) {
  return [
    `№ ${row.productionNo || row.orderNo || '—'}`,
    row.productionNo && row.orderNo && row.orderNo !== row.productionNo ? `договор № ${row.orderNo}` : '',
    row.customer,
  ].filter(Boolean).join(' · ');
}

export async function chooseDirectReceipt(rows) {
  const linked = rows.filter(row => row.salesOrderId);
  if (new Set(linked.map(row => row.salesOrderId)).size > 1) {
    throw new Error('Для прямой поставки отметьте позиции одного заказа');
  }
  const known = linked[0];
  const orderBox = h('div', { hidden: true });
  const object = textInput({ label: 'Объект СМР', max: 200 });
  object.el.hidden = true;
  let order = null;
  const destination = select({
    label: 'Куда приняли', value: '',
    options: [['', 'Выберите назначение'], ['order', 'На заказ'], ...Object.entries(DIRECT_LABELS)],
    onChange: (value) => {
      orderBox.hidden = value !== 'order';
      object.el.hidden = value !== 'smr';
      if (value === 'order' && !order) void showOrders();
    },
  });

  async function showOrders() {
    orderBox.replaceChildren(busyBlock('Заказы'));
    try {
      const orders = (await ordersLookup()).filter(row => row.id && row.stage !== 'cancelled');
      const options = orders.map(row => [row.id, orderLabel(row)]);
      order = select({ label: 'Заказ', options: [
        ['', options.length ? 'Выберите заказ' : 'Нет доступных заказов'], ...options,
      ], value: orders.length === 1 ? orders[0].id : '' });
      orderBox.replaceChildren(field('Заказ', order));
    } catch (error) {
      orderBox.replaceChildren(failBlock(error, showOrders, { text: 'Заказы не загрузились' }));
    }
  }

  return modal({
    title: 'Принять на объект', okText: 'Подтвердить поставку',
    body: stack(h('p', null, `Позиций: ${rows.length}. На склад они не поступят.`),
      known ? h('p', null, lineOrder(known)) : [field('Куда приняли', destination), orderBox, object.el]),
    onOk: () => {
      if (known) return { directOrderId: known.salesOrderId };
      if (!destination.value) throw new Error('Выберите назначение');
      if (destination.value === 'order') {
        if (!order?.value) throw new Error('Выберите заказ');
        return { directOrderId: order.value };
      }
      const costObject = destination.value === 'smr' ? object.value.trim() : '';
      return { directCostCenter: destination.value, ...(costObject ? { directCostObject: costObject } : {}) };
    },
  });
}
