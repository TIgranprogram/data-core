import { h } from '../core/dom.js';
import { PREFIX, session } from '../core/api.js';
import { date, money } from '../core/format.js';
import { readonlyGroup, section, actions, link } from '../ui/kit/index.js';
import { sourceMoney, invoiceCurrency, foreignInvoice } from './invoice-workspace-state.js';

/** Карточка показывает реквизиты; изменение — общая правая форма из меню шапки. */
export function metaBlock(invoice) {
  const tax = invoice.vatMode === 'none' ? 'Без НДС' : invoice.vatMode === 'mixed' ? 'Разные ставки по строкам' : invoice.vatRate == null ? 'Не указан' : `${invoice.vatRate}% · ${invoice.vatMode === 'excluded' ? 'сверху' : 'включён'}`;
  return section({ title: 'Реквизиты', open: false, body: [readonlyGroup({ rows: [
    ['№ счёта', invoice.no || 'Без номера'], ['Дата счёта', invoice.date ? date(invoice.date) : 'Не указана'],
    ['Наша компания', invoice.payerName || 'Не указана'], ['Договор', invoice.contractNo ? `№ ${invoice.contractNo}` : 'Без договора'],
    ...(session.canMoney ? [['Валюта первички', invoiceCurrency(invoice)], ['Итог первички', sourceMoney(invoice.sourceAmount ?? (foreignInvoice(invoice) ? null : invoice.amount), invoice)], ['НДС', tax],
      ['НДС по документу', invoice.declaredVatAmount == null ? 'Не указан' : sourceMoney(invoice.declaredVatAmount, invoice)],
      ['НДС расчётный', invoice.calculatedVatAmount == null ? 'Не указан' : sourceMoney(invoice.calculatedVatAmount, invoice)],
      ['Рублёвый итог', invoice.accountingState === 'unresolved' ? 'Нужен пересчёт' : money(invoice.accountingAmountRub ?? invoice.amount)],
      ['Курс', invoice.exchangeRate ? `${invoice.exchangeRate} ₽ · ${date(invoice.exchangeRateDate)}` : 'Не указан'],
      ['Основание пересчёта', invoice.conversionNote || invoice.exchangeRateSource || '']] : []),
    ['Дата доставки', invoice.deliveryDate ? date(invoice.deliveryDate) : ''], ['Примечание', invoice.note || ''],
  ] }), invoice.files?.length ? actions(...invoice.files.map(file => link({ label: file.name || 'Открыть документ', href: /^https?:\/\//.test(file.url || '') ? file.url : PREFIX + (file.url || '') }))) : null] });
}
