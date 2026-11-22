import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, dateTime, isoDay, money, qty } from '../core/format.js';
import { newKey } from '../core/write-retry.js';
import { button, openCard, readonlyGroup, section, stack, toast } from '../ui/kit/index.js';
import { positionsTable } from '../ui/kit/screens/blocks.js';
import { openProductPicker } from './order-product-picker.js';
import { offerTotals } from './sales-legal-state.js';

const parentPanel = () => [...document.querySelectorAll('aside[data-k="drawer"]:not([hidden])')].at(-1);
const writable = () => session.canEditOrders && session.canMoney;
const ITEM_KEYS = ['productName', 'quantity', 'unit', 'unitPrice', 'productId', 'productSku', 'description', 'color', 'size', 'photoUrl', 'sourceRowKey', 'sourceLine', 'scopeState', 'exclusionReason', 'exclusionConfirmedAt', 'exclusionEventDate', 'matchStatus', 'lineKind', 'photoMm', 'rowMm', 'pageBreakBefore'];
/** GET-проекция содержит вычисленные total: в DTO записи уходят только поддержанные поля. */
export const offerWriteItems = (items) => items.map((x) => Object.fromEntries(ITEM_KEYS.filter((k) => x[k] !== undefined).map((k) => [k, x[k]])));

function matchItem(record, index, ctx, parent) {
  const item = record.items[index];
  return openProductPicker({ title: item.productName, productId: item.productId, product: { name: item.productName, sku: item.productSku, photo: item.photoUrl } }, {
    allowCurrent: true,
    save: (productId) => {
      const items = offerWriteItems(record.items);
      items[index] = { ...items[index], productId, matchStatus: 'confirmed' };
      return api(`/offers/${record.id}`, { method: 'PATCH', body: { ...(record.legal ? { version: record.legalVersion } : {}), items, reason: 'Ручное сопоставление строки КП с изделием' } });
    },
    onSaved: () => { toast('Изделие привязано. Исходная строка и цена сохранены.'); void ctx.reload(); },
    onConflict: ctx.reload,
  }, parent);
}

function scopeItem(record, index, ctx) {
  if (!writable()) return;
  const item = record.items[index];
  const exclude = item.scopeState !== 'excluded';
  let saved = false;
  const title = exclude ? 'Исключить из согласованного состава' : 'Вернуть в согласованный состав';
  const panel = { title, newTitle: title, card: {}, form: {
    toBody: (values) => values,
    fields: () => [
      { note: 'Исходный состав и цена остаются в истории. Изменяется только согласованный объём предложения.' },
      { key: 'reason', label: 'Основание решения', type: 'textarea', required: true, max: 1000, wide: true },
      { key: 'confirmedAt', label: 'Дата подтверждения решения', type: 'date', required: true },
      { key: 'eventDate', label: 'Когда позицию исключили', type: 'date', hint: 'Если фактическая дата неизвестна, оставьте пустым.' },
    ],
    initial: () => ({ confirmedAt: isoDay(), eventDate: '' }), closeAfterCreate: true, saveLabel: 'Сохранить',
    async create(v) {
      const items = offerWriteItems(record.items);
      items[index] = { ...items[index], scopeState: exclude ? 'excluded' : 'included', exclusionReason: v.reason, exclusionConfirmedAt: v.confirmedAt, exclusionEventDate: v.eventDate || null };
      const result = await api(`/offers/${record.id}`, { method: 'PATCH', body: { version: record.legalVersion, items, reason: v.reason } });
      saved = true;
      return result;
    },
  } };
  return openCard(panel, { mode: 'create', parent: parentPanel() }, { changed() {}, close() { if (saved) { void ctx.reload(); ctx.changed?.(); } } });
}

/** Исходные строки КП отображаются до сведений; исключённая строка остаётся видна без производственного действия. */
export function offerPositions(record, ctx) {
  const hasMoney = session.canMoney;
  const totals = offerTotals(record.items);
  const rows = (record.items || []).map((x, index) => {
    const excluded = x.scopeState === 'excluded';
    const status = excluded ? 'Исключена из согласованного состава' : x.productId ? 'Сопоставлено с изделием' : 'Не сопоставлено';
    return {
      cells: [String(index + 1), h('span', null, x.productName, h('div', { class: 'muted small' }, [x.size, status].filter(Boolean).join(' · '))), { v: `${qty(x.quantity)} ${x.unit || ''}`, cls: 'num nowrap' },
        ...(hasMoney ? [{ v: x.unitPrice == null ? '—' : money(x.unitPrice), cls: 'num right nowrap' }, { v: x.unitPrice == null ? '—' : money(x.total ?? Number(x.quantity) * Number(x.unitPrice)), cls: 'num right nowrap' }] : [])],
      expand: () => stack(
        readonlyGroup({ rows: [['Описание', x.sourceLine?.description || x.description], ['Размеры по источнику', x.sourceLine?.dimensions || x.size], ['Состояние', status], ['Основание исключения', x.exclusionReason], ['Решение подтверждено', x.exclusionConfirmedAt ? date(x.exclusionConfirmedAt) : ''], ['Дата исключения', x.exclusionEventDate ? date(x.exclusionEventDate) : excluded ? 'Неизвестна' : '']] }),
        writable() ? stack(
          !excluded ? button({ label: x.productId ? 'Заменить изделие' : 'Сопоставить с изделием', size: 'S', onClick: (e) => matchItem(record, index, ctx, e.currentTarget) }) : null,
          record.legal ? button({ label: excluded ? 'Вернуть в согласованный состав' : 'Исключить из согласованного состава', size: 'S', onClick: () => scopeItem(record, index, ctx) }) : null,
        ) : null,
      ),
    };
  });
  return stack(
    positionsTable({ label: 'Позиции КП', columns: [{ label: '№' }, { label: 'Название и сопоставление' }, { label: 'Количество', num: true }, ...(hasMoney ? [{ label: 'Цена', num: true }, { label: 'Сумма', num: true }] : [])], groups: [{ rows }], empty: { title: 'В КП нет позиций.' } }),
    hasMoney ? readonlyGroup({ rows: [['Исходная сумма', money(record.legal?.gross ?? record.total ?? totals.source)], ['Согласовано', money(record.agreedTotal ?? totals.agreed)]] }) : null,
  );
}

export function offerHistory(record) {
  if (!session.canMoney) return null;
  const versions = record.versions || [];
  return section({ title: 'История предложения', count: versions.length, body: stack(
    h('p', { class: 'hint' }, 'Дата исходного КП сохраняется отдельно от времени ввода и последующих решений.'),
    ...versions.slice(-20).reverse().map((x) => readonlyGroup({ rows: [['Изменение', dateTime(x.at)], ['Автор', x.by || '—'], ['Основание', x.reason || x.snapshot?.reason || 'Сохранена предыдущая редакция']] })),
    !versions.length ? h('p', { class: 'muted' }, 'Изменений после сохранения пока нет.') : null,
  ) });
}

/** Привязка к существующему договору не означает принятие/оплату и не создаёт новый заказ. */
export async function linkOfferContract(record, ctx) {
  if (!writable() || !record.legal) return;
  const data = await api('/salesorders', { query: { limit: 100, sort: '-createdAt' } });
  const candidates = (data.items || []).filter((x) => String(x.companyId) === String(record.companyId));
  let saved = false;
  const clientUid = newKey();
  const panel = { title: 'Связать КП с договором', newTitle: 'Связать КП с договором', card: {}, form: {
    toBody: (values) => values,
    fields: () => [
      { note: 'Связь сохраняет историю предложения. Статус оплаты и принятый состав не меняются.' },
      { key: 'orderId', label: 'Договор покупателя', type: 'select', required: true, choose: true, wide: true, options: candidates.map((x) => ({ value: x.id, label: `Договор ${x.orderNo || '—'} · ${x.customer || 'заказчик не указан'}` })) },
    ], closeAfterCreate: true, saveLabel: 'Сохранить',
    async create({ orderId }) { const result = await api(`/offers/${record.id}/link-order`, { method: 'POST', body: { orderId, version: record.legalVersion, clientUid } }); saved = true; return result; },
  } };
  return openCard(panel, { mode: 'create', parent: parentPanel() }, { changed() {}, close() { if (saved) { void ctx.reload(); ctx.changed?.(); } } });
}
