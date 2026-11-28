import { h } from '../core/dom.js';
import { PREFIX, session } from '../core/api.js';
import { date, money } from '../core/format.js';
import { readonlyGroup, section, actions, link, button, buildForm, stack, toast, toastError } from '../ui/kit/index.js';
import { sourceMoney, invoiceCurrency, foreignInvoice, permissions } from './invoice-workspace-state.js';
import { writeInvoice } from './invoice-workspace-api.js';

export function deliveryBlock(invoice, refresh) {
  const access = permissions(invoice, session);
  if (!access.delivery) return section({ title: 'Доставка', fixed: true, body: [
    readonlyGroup({ rows: [['Дата доставки', invoice.deliveryDate ? date(invoice.deliveryDate) : 'Не указана'], ['Примечание', invoice.note || '']] }),
    h('p', { class: 'hint' }, !access.whole || !access.live ? access.reason : 'Доступен просмотр'),
  ] });

  const initialDate = String(invoice.deliveryDate || '').slice(0, 10);
  const initialNote = String(invoice.note || '').trim();
  const fields = buildForm([
    { key: 'deliveryDate', label: 'Дата доставки', type: 'date' },
    { key: 'note', label: 'Примечание', type: 'textarea', rows: 2, max: 1000, wide: true },
  ], { deliveryDate: initialDate, note: invoice.note || '' });
  const day = fields.el.querySelector('[name=deliveryDate]');
  const note = fields.el.querySelector('[name=note]');
  const save = button({ label: 'Сохранить доставку', type: 'submit', kind: 'primary', disabled: true });
  let busy = false;
  const changes = () => ({
    ...(day.value !== initialDate ? { deliveryDate: day.value } : {}),
    ...(note.value.trim() !== initialNote ? { note: note.value.trim() } : {}),
  });
  const form = h('form', {
    oninput: () => { save.disabled = busy || !Object.keys(changes()).length; },
    onsubmit: async (event) => {
      event.preventDefault();
      const payload = changes();
      if (busy || !Object.keys(payload).length) return;
      busy = save.disabled = day.disabled = note.disabled = true;
      try {
        await writeInvoice(invoice, session, 'delivery', payload);
      } catch (error) {
        busy = save.disabled = day.disabled = note.disabled = false;
        toastError(error);
        return;
      }
      toast('Доставка сохранена');
      if (form.isConnected) await refresh();
    },
  }, stack(fields.el, actions(save)));
  return section({ title: 'Доставка', fixed: true, body: form });
}

/** Карточка показывает реквизиты; изменение — общая правая форма из меню шапки. */
export function metaBlock(invoice) {
  const tax = invoice.vatMode === 'none' ? 'Без НДС' : invoice.vatMode === 'mixed' ? 'Разные ставки по строкам' : invoice.vatRate == null ? 'Не указан' : `${invoice.vatRate}% · ${invoice.vatMode === 'excluded' ? 'сверху' : 'включён'}`;
  return section({ title: 'Реквизиты', side: h('small', { class: 'hint' }, invoice.contractNo ? `Договор № ${invoice.contractNo}` : 'Без договора'), body: readonlyGroup({ rows: [
    ['№ счёта', invoice.no || 'Без номера'], ['Дата счёта', invoice.date ? date(invoice.date) : 'Не указана'],
    ['Наша компания', invoice.payerName || 'Не указана'], ['Договор', invoice.contractNo ? `№ ${invoice.contractNo}` : 'Без договора'],
    ...(session.canMoney ? [['Валюта первички', invoiceCurrency(invoice)], ['Итог первички', sourceMoney(invoice.sourceAmount ?? (foreignInvoice(invoice) ? null : invoice.amount), invoice)], ['НДС', tax],
      ['НДС по документу', invoice.declaredVatAmount == null ? 'Не указан' : sourceMoney(invoice.declaredVatAmount, invoice)],
      ['НДС расчётный', invoice.calculatedVatAmount == null ? 'Не указан' : sourceMoney(invoice.calculatedVatAmount, invoice)],
      ['Рублёвый итог', invoice.accountingState === 'unresolved' ? 'Нужен пересчёт' : money(invoice.accountingAmountRub ?? invoice.amount)],
      ['Курс', invoice.exchangeRate ? `${invoice.exchangeRate} ₽ · ${date(invoice.exchangeRateDate)}` : 'Не указан'],
      ['Основание пересчёта', invoice.conversionNote || invoice.exchangeRateSource || '']] : []),
  ] }) });
}

export function invoiceFilesBlock(invoice) {
  if (!invoice.files?.length) return null;
  return section({ title: 'Файлы счёта', count: invoice.files.length, side: h('small', { class: 'hint' }, invoice.files[0].name || ''),
    body: actions(...invoice.files.map(file => link({ label: file.name || 'Открыть документ', href: /^https?:\/\//.test(file.url || '') ? file.url : PREFIX + (file.url || '') }))) });
}
