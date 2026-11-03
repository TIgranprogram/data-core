import { h } from '../core/dom.js';
import { PREFIX, session } from '../core/api.js';
import { current } from '../core/router.js';
import { date, money, qty } from '../core/format.js';
import { readonlyGroup, section, table, button, actions, link, badge, INVOICE_STATUS, SUPPLY_STATUS, confirmDlg, failBlock, toast, toastError } from '../ui/kit/index.js';
import { permissions, lineAmount, pendingLines, assertOperation } from './invoice-workspace-state.js';
import { getInvoice, getCandidates, getPayers, getContracts, writeInvoice } from './invoice-workspace-api.js';
import { buildWorkspaceForm } from './invoice-workspace-forms.js';

/** Router-only ссылка: сохраняет экран/фильтры/страницу; native hash проходит штатный guard. */
export function workspaceHref(changes) {
  const route = current();
  const params = { ...route.params, fill: undefined, ...changes };
  return '#' + (route.section || 'requests') + '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
}
const fileUrl = (url) => /^https?:\/\//.test(url || '') ? url : PREFIX + (url || '');
const lineTitle = (r) => (r.num ? `№${r.num} · ` : '') + (r.title || r.materialName || 'Позиция');

function positions(invoice, ctx, { editable = true, commands = true, receiveChecks } = {}) {
  const p = permissions(invoice, session);
  const columns = [{ label: 'Позиция', cls: 'clip' }, { label: 'Количество', num: true },
    ...(session.canMoney ? [{ label: 'Цена / ед.', num: true }, { label: 'Сумма строки', num: true }] : []), { label: 'Статус' }, { label: 'Действия' }];
  if (receiveChecks) columns.unshift({ label: 'Принять' });
  const rows = (invoice.requests || []).map((line) => {
    const mutable = !line.deletedAt && !['received', 'cancelled'].includes(line.status);
    const controls = actions(
      editable && p.editLine && mutable ? button({ label: 'Изменить', onClick: () => ctx.edit({ _operation: 'line', _lineId: line.id }) }) : null,
      editable && commands && p.removeLine && mutable ? button({ label: 'Убрать', kind: 'ghost', onClick: () => command(invoice, ctx, 'remove', line.id) }) : null);
    const sum = lineAmount(line);
    const cells = [link({ label: lineTitle(line), href: workspaceHref({ of: 'requests', open: line.id, new: undefined }) }),
      `${qty(line.qty)} ${line.unit || ''}`, ...(session.canMoney ? [Number(line.qty) > 0 ? money(sum / Number(line.qty)) : '—', money(sum)] : []), badge(SUPPLY_STATUS, line.status === 'ordered' && line.paid ? 'paid' : line.status), controls];
    if (receiveChecks) {
      const cb = mutable ? h('input', { type: 'checkbox', checked: true, 'aria-label': 'Принять ' + lineTitle(line) }) : null;
      if (cb) receiveChecks.set(line.id, cb);
      cells.unshift(cb);
    }
    return { data: line.id, cells };
  });
  return table({ label: 'Позиции счёта', columns, rows, maxHeight: 'L', empty: { title: 'В счёте пока нет позиций', hint: p.add ? 'Добавьте существующие заявки кнопкой «Добавить заявки».' : 'Этот счёт доступен только для просмотра.' } });
}

async function command(invoice, ctx, operation, lineId, body = {}) {
  try {
  assertOperation(invoice, session, operation, lineId);
  const titles = { remove: 'Убрать позицию из счёта?', issue: 'Выставить счёт?', pay: 'Отметить счёт оплаченным?', receive: 'Принять отмеченные позиции на склад?' };
  const notes = { remove: 'Заявка останется и вернётся в «В заказ». Сумма счёта пересчитается.', issue: 'Сначала сохраните реквизиты. Это отдельное выставление счёта, без оплаты.', pay: 'Будет зафиксирован факт оплаты полного счёта. Реквизиты и позиции эта команда не сохраняет.', receive: 'Будут приняты только отмеченные позиции. Первая приёмка зафиксирует финансы всего счёта.' };
  if (operation === 'receive' && !body.requestIds?.length) { toast('Отметьте позиции, которые приехали', { error: true }); return; }
  if (!(await confirmDlg(titles[operation], notes[operation], { okText: operation === 'remove' ? 'Убрать' : 'Подтвердить', danger: operation === 'remove' }))) return;
  await ctx.run(async () => {
    await writeInvoice(invoice, session, operation, body, lineId);
    toast({ remove: 'Позиция убрана', issue: 'Счёт выставлен', pay: 'Счёт оплачен', receive: 'Позиции приняты на склад' }[operation]);
    ctx.changed();
    try { await ctx.setRow(await getInvoice(invoice.id)); }
    catch (error) { await ctx.setRow({ id: invoice.id, _refreshError: error }); }
  });
  } catch (error) { toastError(error); }
}

function summary(invoice) {
  const rows = [['Поставщик', invoice.supplierName || 'Не указан'], ['Дата', invoice.date ? date(invoice.date) : 'Не указана'], ['Статус', badge(INVOICE_STATUS, invoice.status)],
    [invoice.partial ? 'Видимых позиций' : 'Позиций', (invoice.requests || []).length]];
  if (session.canMoney) rows.push([invoice.partial ? 'Сумма видимых строк' : 'Текущая сумма', money(invoice.amount)], ['Наша компания', invoice.payerName],
    invoice.paymentSnapshot ? ['Исходный платёж', `${money(invoice.paymentSnapshot.amount)} · ${date(invoice.paymentSnapshot.paidAt)}`] : null);
  return readonlyGroup({ title: 'Сведения и итоги', rows });
}
function details(invoice, ctx) {
  if (invoice._refreshError) return failBlock(invoice._refreshError, () => ctx.reload(), { text: 'Сохранено, но обновить показ не удалось. Повторить только загрузку' });
  const p = permissions(invoice, session), checks = p.receive ? new Map() : null;
  const topActions = actions(button({ label: 'Обновить счёт', kind: 'ghost', onClick: () => ctx.reload() }), p.add ? button({ label: 'Добавить заявки', onClick: () => ctx.edit({ _operation: 'add' }) }) : null,
    p.issue ? button({ label: 'Выставить счёт', onClick: () => command(invoice, ctx, 'issue') }) : null,
    p.pay ? button({ label: 'Счёт оплачен', onClick: () => command(invoice, ctx, 'pay') }) : null);
  const files = invoice.files || [];
  const adjustments = session.canMoney ? invoice.paymentAdjustments || [] : [];
  const orders = (invoice.orders || []).map((order) => typeof order === 'object' ? order : { productionNo: order });
  return h('div', { 'data-invoice-workspace': invoice.id }, summary(invoice), p.reason ? h('p', { class: 'hint', 'data-invoice-lock': '' }, p.reason) : null,
    topActions,
    section({ title: 'Позиции', count: (invoice.requests || []).length, open: true, body: [positions(invoice, ctx, { receiveChecks: checks }), checks ? actions(
      h('span', { class: 'hint' }, 'Отметьте только приехавшие позиции.'),
      button({ label: 'Принять на склад', onClick: () => command(invoice, ctx, 'receive', null, { requestIds: [...checks].filter(([, cb]) => cb.checked).map(([id]) => id) }) })) : null] }),
    section({ title: 'Реквизиты', body: readonlyGroup({ rows: [['№ счёта', invoice.no || 'Без номера'], ['Дата', invoice.date ? date(invoice.date) : 'Не указана']] }) }),
    section({ title: 'Файлы', count: files.length, body: files.length ? table({ label: 'Файлы счёта', columns: [{ label: 'Файл' }], rows: files.map((file) => ({ cells: [link({ label: file.name || 'Файл счёта', href: fileUrl(file.url), target: '_blank' })] })) }) : h('p', { class: 'hint' }, 'Файлов пока нет. Добавьте их в «Реквизиты счёта».') }),
    section({ title: 'Договор и заказы', body: [readonlyGroup({ rows: [['Договор поставщика', invoice.contractId ? link({ label: `№ ${invoice.contractNo || '—'}`, href: workspaceHref({ of: 'contract', open: invoice.contractId, new: undefined }) }) : 'Без договора']] }),
      orders.length ? table({ label: 'Связанные заказы', columns: [{ label: 'Заказ' }, { label: 'Договоры' }], rows: orders.map((order) => ({ cells: [link({ label: `Заказ № ${order.productionNo || '—'}`, href: '#salesorders?q=' + encodeURIComponent(order.productionNo || '') }), (order.contracts || []).join(', ') || '—'] })) }) : h('p', { class: 'hint' }, 'К заказам не привязан.')] }),
    session.canMoney && invoice.paymentSnapshot ? section({ title: 'Оплата и корректировки', count: adjustments.length, body: [h('p', { class: 'hint' }, 'Исходный платёж неизменяем. Корректировки меняют текущую сумму строк, но не банковский платёж.'),
      table({ label: 'Корректировки после оплаты', columns: [{ label: 'Дата' }, { label: 'Причина', cls: 'clip' }, { label: 'Изменение', num: true }], rows: adjustments.map((a) => ({ cells: [date(a.at), a.reason, money(a.delta)] })), empty: { title: 'Корректировок пока нет', hint: 'Здесь появятся причины изменения оплаченного счёта.' } })] }) : null);
}

export const invoiceCard = {
  id: 'invoicecard', title: 'Счёт поставщика', kind: 'Счёт', noun: 'счёт', entityType: 'SupplyInvoice',
  canEdit: () => session.canEdit,
  get: getInvoice,
  card: {
    heading: (invoice) => invoice.no ? `Счёт № ${invoice.no}` : 'Счёт без номера',
    subheading: (invoice) => [invoice.date ? date(invoice.date) : '', invoice.supplierName].filter(Boolean).join(' · '),
    noHistory: true, view: () => [],
    editable: (invoice) => !invoice._refreshError && permissions(invoice, session).meta,
    editLabel: 'Реквизиты счёта',
    extra: details,
  },
  form: {
    build: async (base, ctx) => {
      // Всегда новый GET перед формой: version и boundary не берём из списка или старого draft.
      const fresh = await getInvoice(base.id);
      return buildWorkspaceForm(fresh, { operation: base._operation || 'meta', lineId: base._lineId }, {
        candidates: getCandidates, payers: getPayers, contracts: getContracts, href: workspaceHref, refresh: () => ctx.reload(), edit: (draft) => ctx.edit(draft),
        overview: (invoice) => positions(invoice, ctx, { commands: false }),
      });
    },
    toBody: (values) => values,
    update: async (id, values) => {
      await writeInvoice(values.invoice, session, values.operation, values.body, values.lineId);
      try { return await getInvoice(id); }
      catch (error) { return { id, _refreshError: error }; } // write уже подтверждён; повторять его нельзя
    },
  },
};
