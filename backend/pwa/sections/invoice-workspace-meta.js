import { h } from '../core/dom.js';
import { session } from '../core/api.js';
import { date } from '../core/format.js';
import { readonlyGroup, section, photoField, enhanceSelect, select, textInput, buildForm, toast, toastError } from '../ui/kit/index.js';
import { permissions, metaBody } from './invoice-workspace-state.js';
import { getPayers, getContracts, writeInvoice } from './invoice-workspace-api.js';

/** Реквизиты на том же экране: поля + выпадающие списки, сохранение по blur / смене. */
export function metaBlock(invoice, ctx, refreshInvoice) {
  const p = permissions(invoice, session);
  if (!p.meta) {
    return readonlyGroup({ title: 'Реквизиты', rows: [
      ['№ счёта', invoice.no || 'Без номера'], ['Дата', invoice.date ? date(invoice.date) : 'Не указана'],
      ['Наша компания', invoice.payerName || '—'],
      ['Договор', invoice.contractNo ? `№ ${invoice.contractNo}` : 'Без договора'],
      ...(invoice.deliveryDate ? [['Дата доставки', date(invoice.deliveryDate)]] : []),
      ...(invoice.note ? [['Примечание', invoice.note]] : []),
    ] });
  }
  const no = textInput({ label: '№ счёта', value: invoice.no || '', max: 100 }).input;
  const dateInp = textInput({ label: 'Дата счёта', type: 'date', value: String(invoice.date || '').slice(0, 10) }).input;
  const deliveryFields = buildForm([
    { key: 'deliveryDate', label: 'Дата доставки', type: 'date' },
    { key: 'note', label: 'Примечание', type: 'textarea', max: 1000, wide: true },
  ], { deliveryDate: String(invoice.deliveryDate || '').slice(0, 10), note: invoice.note || '' });
  const payer = select({ label: 'Наша компания', disabled: !p.payer, options: [['', 'Выберите компанию']] });
  const contract = select({ label: 'Договор', options: [['', 'Без договора']] });
  enhanceSelect(payer);
  enhanceSelect(contract);
  const files = photoField(invoice.files || [], { pdf: true });
  const knownIds = (invoice.fileIds || (invoice.files || []).map((f) => f.id)).map(String);
  const unseenIds = knownIds.filter((id) => !(invoice.files || []).some((f) => String(f.id) === id));
  const fileIds = () => [...unseenIds, ...files.ids()];
  let saving = false;
  const saveMeta = async () => {
    if (saving) return;
    saving = true;
    try {
      const body = metaBody(invoice, {
        no: no.value, date: dateInp.value, ...deliveryFields.read().values, payerCompanyId: payer.value, contractId: contract.value, fileIds: fileIds(),
      }, session);
      const ok = await ctx.run(async () => {
        await writeInvoice(invoice, session, 'meta', body);
        toast('Реквизиты сохранены');
        ctx.changed();
        await refreshInvoice(invoice, ctx);
      });
      if (!ok) return;
    } catch (e) { toastError(e); }
    finally { saving = false; }
  };
  for (const el of [no, dateInp, payer, contract]) el.addEventListener('change', saveMeta);
  deliveryFields.el.addEventListener('change', saveMeta);
  files.el.addEventListener('change', () => saveMeta(), true);
  (async () => {
    try {
      const [payers, contracts] = await Promise.all([p.payer ? getPayers() : [], getContracts(invoice.supplierId)]);
      if (p.payer && invoice.payerCompanyId && !payers.some((x) => String(x.value) === String(invoice.payerCompanyId))) {
        payers.push({ value: String(invoice.payerCompanyId), label: invoice.payerName || 'Текущая компания' });
      }
      payer.replaceChildren(h('option', { value: '' }, 'Выберите компанию'), ...payers.map((x) => h('option', { value: x.value, selected: String(x.value) === String(invoice.payerCompanyId || '') || null }, x.label)));
      const opts = [{ value: '', label: 'Без договора' }, ...contracts.map((c) => ({ value: c.id, label: `№ ${c.no} от ${date(c.date)}` }))];
      if (invoice.contractId && !contracts.some((c) => String(c.id) === String(invoice.contractId))) {
        opts.push({ value: invoice.contractId, label: `№ ${invoice.contractNo || '—'} (текущий)` });
      }
      contract.replaceChildren(...opts.map((o) => h('option', { value: o.value, selected: String(o.value) === String(invoice.contractId || '') || null }, o.label)));
    } catch (e) { toastError(e, 'справочники счёта'); }
  })();
  return section({ title: 'Реквизиты', open: true, body: [
    h('div', { class: 'iw-meta form-grid' },
      h('label', { class: 'field' }, h('span', null, '№ счёта'), no),
      h('label', { class: 'field' }, h('span', null, 'Дата'), dateInp),
      p.payer ? h('label', { class: 'field' }, h('span', null, 'Наша компания'), payer) : null,
      h('label', { class: 'field wide' }, h('span', null, 'Договор поставщика'), contract)),
    deliveryFields.el,
    h('div', { class: 'iw-files' }, h('div', { class: 'muted small' }, 'Файлы счёта'), files.el),
  ] });
}

