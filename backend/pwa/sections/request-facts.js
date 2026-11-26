import { grp, section, table } from '../ui/kit/index.js';
import { h } from '../core/dom.js';
import { session } from '../core/api.js';
import { date, money, qty } from '../core/format.js';
import { badge, COST_CENTER, PRIORITY, SUPPLY_STATUS, supplyKey } from '../ui/kit/badges.js';
import { stageStrip } from './request-step.js';
import { orderTag } from './requests.js';

export const FACTS = ['Количество', 'Примечание', 'Куда', 'Заказ / заказчик', 'Поставщик', 'Сумма с НДС', 'Ответственный'];
/** Все сведения заявки парами (группы — заголовки grp) для infoCard. */
export const requestPairs = (r) => [
  grp('Заявка'),
  ['Статус', h('div', null, stageStrip(r) || badge(SUPPLY_STATUS, supplyKey(r)), r.priority && r.priority !== 'normal' ? badge(PRIORITY, r.priority) : '')],
  ['Количество', `${qty(r.qty)} ${r.unit || ''}`.trim()],
  ['Куда', [COST_CENTER[r.costCenter] || (r.salesOrderId ? COST_CENTER.order : ''), r.costObject].filter(Boolean).join(' · ')],
  ['Категория', r.categoryName],
  ['Ответственный', r.responsible],
  ['Заказ / заказчик', r.salesOrderId ? h('a', { href: '#salesorders?open=' + r.salesOrderId }, r.orderLabel || orderTag(r)) : r.orderLabel],
  ['Получено', r.status === 'received' ? (r.receivedTo === 'direct' ? 'без склада — сразу в работу / по назначению' : 'на склад') : ''],
  ['Принято', r.status === 'received' && r.receivedQty ? qty(r.receivedQty) : ''],
  grp('Деньги'),
  ['Сумма с НДС', session.canMoney && r.priceHint ? money(r.priceHint) : ''], ['Статья расхода', session.canMoney ? r.articleName : ''],
  ['В каталоге сейчас', session.canMoney && r.catalogCurrentPrice != null
    ? h('span', { class: 'hint', title: 'Текущая цена в каталоге поставщика — заявка не меняется' },
        money(r.catalogCurrentPrice) + ' ₽',
        r.catalogPriceHistory?.length > 1
          ? section({ title: 'История цены', tone: 'neutral', body: table({ columns: [{ label: 'Дата' }, { label: 'Цена', num: true }, { label: 'Откуда' }],
              rows: r.catalogPriceHistory.map((e) => ({ cells: [date(e.date), money(e.price) + ' ₽', { v: e.source === 'excel' ? 'Excel' : 'заявка', cls: 'muted' }] })) }) })
          : null
      )
    : ''],
  grp('Счёт и поставщик'),
  ['Поставщик', r.supplierName],
  ['Наша компания', r.companyName],
  ['Тип счёта', r.invoiceType],
  ['№ счёта', r.invoiceNo],
  ['Дата счёта', r.invoiceDate ? date(r.invoiceDate) : ''],
  ['Доставка', r.deliveryNote],
  grp('Товар'),
  ['Артикул', r.article],
  ['Цвет', r.color],
  ['Короткое (склад)', r.materialId && r.materialName && r.materialName !== r.title ? r.materialName : ''],
  ['Позиция склада', r.materialId ? h('a', { href: '#stock?open=' + r.materialId }, r.materialName || 'открыть') : ''],
  ['Ссылка', r.productUrl ? h('a', { href: r.productUrl, target: '_blank', rel: 'noopener' }, 'открыть') : ''],
  grp('Дополнительно'),
  ['Примечание', r.notes],
];
