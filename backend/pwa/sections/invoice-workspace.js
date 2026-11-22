import { metaBlock } from './invoice-workspace-meta.js';
import { h } from '../core/dom.js';
import { api, PREFIX, session } from '../core/api.js';
import { current } from '../core/router.js';
import { chooseDirectReceipt, directReceiptLabel, lineOrder } from './invoice-workspace-receipt.js';
import { date, dateTime, money, qty } from '../core/format.js';
import { stack, section, table, button, actions, link, badge, INVOICE_STATUS, SUPPLY_STATUS, confirmDlg, failBlock, toast, toastError, attachCombo } from '../ui/kit/index.js';
import { permissions, lineAmount, pendingLines, assertOperation, addBody, takeInvoiceOperation, sourceMoney, foreignInvoice, paymentStateLabel, invoiceWarnings, needsPaymentDate } from './invoice-workspace-state.js';
import { adminAction, askReason } from './admin-override.js';
import { getInvoice, getCandidates, getBusyRequests, getPayers, getContracts, writeInvoice, deleteInvoice } from './invoice-workspace-api.js';
import { buildWorkspaceForm } from './invoice-workspace-forms.js';
import { screenCard } from '../ui/kit/screens/card.js';
import { positionsTable } from '../ui/kit/screens/blocks.js';

/** Router-only ссылка: сохраняет экран/фильтры/страницу; native hash проходит штатный guard. */
export function workspaceHref(changes) {
  const route = current();
  const params = { ...route.params, fill: undefined, ...changes };
  return '#' + (route.section || 'requests') + '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
}
const fileUrl = (url) => /^https?:\/\//.test(url || '') ? url : PREFIX + (url || '');
const lineTitle = (r) => (r.num ? `№${r.num} · ` : '') + (r.title || r.materialName || 'Позиция');

async function refreshInvoice(invoice, ctx) {
  try { await ctx.setRow(await getInvoice(invoice.id)); }
  catch (error) { await ctx.setRow({ id: invoice.id, _refreshError: error }); }
}

function positions(invoice, ctx, { editable = true, commands = true, receiveChecks } = {}) {
  const p = permissions(invoice, session);
  // «Цена / ед.» — второй строкой под суммой, статус — под названием: таблица не шире панели
  const columns = [{ label: 'Позиция', wrap: true }, { label: 'Кол-во', num: true, cls: 'nowrap' },
    ...(session.canMoney ? [{ label: 'Сумма', num: true }] : []),
  ];
  if (receiveChecks) columns.unshift({ label: 'Принять' });
  const rows = (invoice.requests || []).map((line) => {
    const mutable = !line.deletedAt && !['received', 'cancelled'].includes(line.status);
    // принятую позицию администратор переоценивает (цена, сумма), количество — уже на складе
    const sum = lineAmount(line);
    const qtyCell = `${qty(line.qty)} ${line.unit || ''}`.trim();
    const priceCell = !session.canMoney ? null : foreignInvoice(invoice) ? sourceMoney(line.sourceUnitPrice, invoice) : Number(line.qty) > 0 ? money(sum / Number(line.qty)) : '—';
    const sumCell = !session.canMoney ? null : foreignInvoice(invoice) ? sourceMoney(line.sourceGrossAmount ?? line.sourceLineAmount, invoice) : money(sum);
    // таблица — только чтение: «Убрать» / «Отменить приёмку» — в раскрытии строки (эталон заказа, C119)
    const controls = editable && commands && p.editLine && mutable
      ? () => actions(button({ label: 'Изменить позицию', onClick: () => ctx.edit({ _operation: 'line', _lineId: line.id }) }), p.removeLine ? button({ label: 'Убрать из счёта', kind: 'ghost', onClick: () => command(invoice, ctx, 'remove', line.id) }) : null)
      : editable && commands && p.removeLine && mutable
      ? () => actions(button({ label: 'Убрать из счёта', kind: 'ghost', onClick: () => command(invoice, ctx, 'remove', line.id) }))
      : editable && commands && p.rollback && line.status === 'received'
        ? () => actions(button({ label: 'Отменить приёмку', kind: 'danger', onClick: () => override(invoice, ctx, 'rollback', line) }))
        : null;
    // Название позиции — текст, без перехода в раздел заявок (один экран счёта).
    const direct = line.status === 'received' && line.receivedTo === 'direct';
    const receipt = direct ? badge(line.salesOrderId ? 'На объекте' : directReceiptLabel(line), 'ok')
      : badge(SUPPLY_STATUS, line.status === 'ordered' && line.paid ? 'paid' : line.status);
    const cells = [stack(h('span', { title: lineTitle(line) }, lineTitle(line)), receipt,
      line.salesOrderId ? link({ label: lineOrder(line), href: '#salesorders?open=' + line.salesOrderId }) : null),
      qtyCell, ...(session.canMoney ? [stack(sumCell, h('span', { class: 'muted small' }, priceCell === '—' ? priceCell : `${priceCell} / ед.`))] : [])];
    if (receiveChecks) {
      const cb = mutable ? h('input', { type: 'checkbox', checked: true, 'aria-label': 'Принять ' + lineTitle(line) }) : null;
      if (cb) receiveChecks.set(line.id, cb);
      cells.unshift(cb);
    }
    return { data: line.id, cells, expand: controls };
  });
  const empty = { title: 'В счёте пока нет позиций', hint: p.add ? 'Добавьте позицию полем под таблицей или «+ Новая позиция».' : 'Этот счёт доступен только для просмотра.' };
  if (commands) return positionsTable({ label: 'Позиции счёта', columns, groups: [{ rows: rows.map((r) => (r.expand ? r : { cells: r.cells })) }], empty });
  return table({ label: 'Позиции счёта', columns, rows, maxHeight: 'L', empty });
}

/** Администратор: снять оплату со счёта или отменить приёмку позиции (окно с последствиями и причиной). */
async function override(invoice, ctx, kind, line) {
  try {
    const path = kind === 'unpay' ? `/supply/invoices/${invoice.id}/unpay` : `/supply/requests/${line.id}/rollback-receipt`;
    const done = await adminAction(path, kind === 'unpay'
      ? { title: 'Снять оплату со счёта?', okText: 'Снять оплату', lead: 'Счёт вернётся в «Выставлен», деньги уйдут из календаря оплат. Запись о снятии сохранится.' }
      : { title: 'Отменить приёмку?', okText: 'Отменить приёмку', lead: line.receivedTo === 'direct'
        ? `Приёмка позиции «${lineTitle(line)}» будет отменена, позиция вернётся на прежний этап.`
        : `Позиция «${lineTitle(line)}» уйдёт со склада и вернётся на прежний этап.` });
    if (!done) return;
    toast(kind === 'unpay' ? 'Оплата снята' : 'Приёмка отменена');
    ctx.changed();
    await ctx.reload();
  } catch (error) { toastError(error); }
}

async function command(invoice, ctx, operation, lineId, body = {}) {
  if (operation === 'pay') return ctx.edit({ _operation: 'payment' });
  try {
  assertOperation(invoice, session, operation, lineId);
  const titles = { remove: 'Убрать позицию из счёта?', issue: 'Выставить счёт?', pay: 'Отметить счёт оплаченным?', receive: 'Принять отмеченные позиции на склад?' };
  const notes = { remove: 'Заявка останется и вернётся в «Заказать». Сумма счёта пересчитается.', issue: 'Нужны №, дата, сумма и наша компания. Это выставление без оплаты.', pay: 'Нужна наша компания — иначе расход не попадёт в «Деньги». Реквизиты эта команда не сохраняет.', receive: 'Будут приняты только отмеченные позиции. Первая приёмка зафиксирует финансы всего счёта.' };
  if (operation === 'receive' && !body.requestIds?.length) { toast('Отметьте позиции, которые приехали', { error: true }); return; }
  const direct = !!(body.directOrderId || body.directCostCenter);
  if (!direct && !(await confirmDlg(titles[operation], notes[operation], { okText: operation === 'remove' ? 'Убрать' : 'Подтвердить', danger: operation === 'remove' }))) return;
  await ctx.run(async () => {
    await writeInvoice(invoice, session, operation, body, lineId);
    toast({ remove: 'Позиция убрана', issue: 'Счёт выставлен', pay: 'Счёт оплачен', receive: direct ? 'Поставка на объект отмечена' : 'Позиции приняты на склад' }[operation]);
    ctx.changed();
    await refreshInvoice(invoice, ctx);
  });
  } catch (error) { toastError(error); }
}

/** Поле «+» → выпадающий список заявок; выбор сразу добавляет в счёт. */
function addPicker(invoice, ctx) {
  const p = permissions(invoice, session);
  if (!p.add) return null;
  let cache = [];
  const input = h('input', { type: 'search', class: 'iw-add-inp', placeholder: 'Добавить позицию из заявок…', 'aria-label': 'Добавить в счёт позицию из заявок', autocomplete: 'off' });
  const wrap = h('div', { class: 'iw-add has-combo' }, h('span', { class: 'iw-add-plus', 'aria-hidden': 'true' }, '+'), input);
  const fromName = (f) => `счёт ${f.no ? '№' + f.no : 'без номера'}${f.status && INVOICE_STATUS[f.status] ? ' · ' + INVOICE_STATUS[f.status].label.toLowerCase() : ''}`;
  const load = async (q = '') => {
    try {
      const [r, busy] = await Promise.all([getCandidates(invoice, { page: 1, q, limit: 80 }), getBusyRequests(invoice, { q }).catch((e) => { toastError(e, 'заявки из других счетов'); return []; })]);
      cache = [
        ...(r.items || []).map((x) => ({
          value: x.id,
          label: lineTitle(x),
          sub: [`${qty(x.qty)} ${x.unit || ''}`.trim(), SUPPLY_STATUS[x.status === 'ordered' && x.paid ? 'paid' : x.status]?.label].filter(Boolean).join(' · '),
          ...(busy.length ? { group: 'Свободные заявки' } : {}),
        })),
        // заявки в другом счёте: выбор — перенос сюда (из оплаченного — нельзя, деньги уже ушли)
        ...busy.map((x) => ({
          value: x.id,
          label: lineTitle(x),
          sub: [`${qty(x.qty)} ${x.unit || ''}`.trim(), `сейчас в: ${fromName(x.from)}`, x.from.status === 'paid' ? 'оплачен — перенести нельзя' : 'выбрать — перенести сюда'].join(' · '),
          group: 'В других счетах',
          from: x.from,
        })),
      ];
    } catch (e) { toastError(e, 'загрузить заявки'); cache = []; }
    return cache;
  };
  attachCombo(input, {
    options: () => cache,
    empty: () => 'Нет свободных заявок и заявок в других счетах — создайте новую ниже',
    onPick: async (o) => {
      input.value = '';
      try {
        assertOperation(invoice, session, 'add');
        const body = addBody(invoice, [o.value]);
        if (o.from) {
          if (o.from.status === 'paid') { toastError(new Error(`Заявка в оплаченном счёте (${fromName(o.from)}) — перенести нельзя`)); return; }
        }
        // счёт-источник останется пустым — удалим его, чтобы не копились пустые черновики
        const emptyAfter = !!o.from && Array.isArray(o.from.requests) && o.from.requests.filter((r) => !r.deletedAt && r.status !== 'cancelled' && String(r.id) !== String(o.value)).length === 0;
        if (o.from && !(await confirmDlg('Перенести заявку в этот счёт?', `«${o.label}» уберётся из: ${fromName(o.from)} — и добавится сюда.${emptyAfter ? ' Тот счёт останется пустым — он удалится.' : ''}`, { okText: 'Перенести' }))) return;
        const ok = await ctx.run(async () => {
          if (o.from) await writeInvoice(o.from, session, 'remove', {}, o.value);
          await writeInvoice(invoice, session, 'add', body);
          let dropped = false;
          if (emptyAfter) { try { await deleteInvoice(o.from.id); dropped = true; } catch { /* нет права или счёт занят — останется пустым */ } }
          toast(o.from ? `Заявка перенесена из: ${fromName(o.from)}${dropped ? ' — пустой счёт удалён' : ''}` : 'Заявка добавлена в счёт');
          ctx.changed();
          await refreshInvoice(invoice, ctx);
        });
        if (!ok) return;
      } catch (e) { toastError(e); }
    },
  });
  // список открывается щелчком (или вводом) раньше, чем пришли заявки, — после загрузки перерисовать его
  let redraw = false; const loadAndShow = (q) => load(q).then(() => { if (document.activeElement !== input) return; redraw = true; input.dispatchEvent(new Event('input')); redraw = false; });
  input.addEventListener('focus', () => loadAndShow(input.value.trim()));
  input.addEventListener('input', () => { if (redraw) return; const q = input.value.trim(); clearTimeout(input._t); input._t = setTimeout(() => loadAndShow(q), 220); });
  load();
  return h('div', { class: 'iw-add-row' }, wrap, h('p', { class: 'hint' }, 'Позиция счёта — это заявка. Клик по полю — список заявок к заказу; выбор сразу добавляет позицию в счёт. Позицию из другого счёта — переносит сюда. Нет в списке (доставка, услуга) — «+ Новая позиция».'));
}

/** Компактная форма новой заявки внизу экрана счёта — без перехода в раздел «Заявки». */
function newRequestBar(invoice, ctx) {
  const p = permissions(invoice, session);
  if (!p.add) return null;
  const panel = h('div', { class: 'iw-new', hidden: true });
  const title = h('input', { name: 'title', maxlength: 500, placeholder: 'Название позиции', 'aria-label': 'Название новой позиции' });
  const qtyInp = h('input', { name: 'qty', type: 'number', min: '0', step: 'any', value: '1', inputmode: 'decimal', 'aria-label': 'Количество' });
  const unit = h('input', { name: 'unit', maxlength: 40, value: 'шт', 'aria-label': 'Единица' });
  const toggle = button({ label: '+ Новая позиция', kind: 'ghost', onClick: () => { panel.hidden = !panel.hidden; if (!panel.hidden) title.focus(); } });
  const create = button({ label: 'Создать и добавить', kind: 'primary', onClick: async () => {
    const name = title.value.trim();
    if (!name) { toast('Впишите название', { error: true }); title.focus(); return; }
    const q = Number(qtyInp.value);
    if (!Number.isFinite(q) || q <= 0) { toast('Количество должно быть больше нуля', { error: true }); return; }
    try {
      const created = await api('/supply/requests', { method: 'POST', body: {
        title: name, qty: q, unit: unit.value.trim() || 'шт',
        statusLabel: SUPPLY_STATUS.requested.label, requestedBy: session.name,
        ...(invoice.supplierId ? { supplierId: invoice.supplierId, supplierName: invoice.supplierName } : {}),
      } });
      assertOperation(invoice, session, 'add');
      const body = addBody(invoice, [created.id]);
      const ok = await ctx.run(async () => {
        await writeInvoice(invoice, session, 'add', body);
        toast('Заявка создана и добавлена в счёт');
        ctx.changed();
        await refreshInvoice(invoice, ctx);
      });
      if (!ok) return;
    } catch (e) { toastError(e); }
  } });
  panel.replaceChildren(
    h('div', { class: 'iw-new-grid' },
      h('label', { class: 'field wide' }, h('span', null, 'Название'), title),
      h('label', { class: 'field' }, h('span', null, 'Кол-во'), qtyInp),
      h('label', { class: 'field' }, h('span', null, 'Ед.'), unit)),
    actions(create, button({ label: 'Отмена', kind: 'ghost', onClick: () => { panel.hidden = true; } })));
  return h('div', { class: 'iw-new-wrap' }, toggle, panel);
}

/** Обе команды приёмки используют один набор отмеченных позиций счёта. */
const checksOf = new WeakMap();
const markedIds = invoice => [...(checksOf.get(invoice) || [])].filter(([, cb]) => cb.checked).map(([id]) => id);

async function receiveOnObject(invoice, ctx) {
  try {
    assertOperation(invoice, session, 'receive');
    const requestIds = markedIds(invoice);
    if (!requestIds.length) { toast('Отметьте позиции, которые получил объект', { error: true }); return; }
    const target = await chooseDirectReceipt(invoice.requests.filter(row => requestIds.includes(row.id)));
    if (target) await command(invoice, ctx, 'receive', null, { requestIds, ...target });
  } catch (error) { toastError(error); }
}
async function voidPayment(invoice, payment, ctx) {
  try {
    const path = `/supply/invoices/${invoice.id}/payments/${payment.id}/void`;
    const plan = await api(path + '?dryRun=1', { method: 'POST', body: {} });
    if (plan?.canProceed === false) { toast((plan.blockers || ['Сторно сейчас недоступно']).join(' '), { error: true }); return; }
    const reason = await askReason('Сторнировать ошибочную оплату?', 'Факт исключится из своего дня, но останется в истории. Это не возврат денег поставщиком.', 'Сторнировать');
    if (!reason) return;
    const clientUid = globalThis.crypto?.randomUUID?.() || `void-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await api(path, { noWait: true, method: 'POST', body: { confirm: true, reason, clientUid, version: Number(invoice.version ?? 0) } });
    toast('Ошибочная оплата сторнирована'); ctx.changed(); await ctx.reload();
  } catch (error) { toastError(error); }
}
function paymentHistory(invoice, ctx) {
  if (!session.canMoney) return null;
  const records = [...(invoice.payments || [])];
  let page = 1, busy = false;
  const historyBox = h('div');
  const loadMore = button({ label: 'Показать ранние оплаты', onClick: async () => {
    if (busy) return; busy = true; loadMore.disabled = true;
    try { const result = await api(`/supply/invoices/${invoice.id}/payments`, { query: { page: page + 1, limit: 100 } });
      for (const payment of result.items || []) if (!records.some(x => x.id === payment.id)) records.push(payment);
      page++; render();
    } catch (error) { toastError(error); } finally { busy = false; loadMore.disabled = false; }
  } });
  const p = permissions(invoice, session);
  const render = () => { historyBox.replaceChildren(positionsTable({ label: 'История оплат счёта', columns: [{ label: 'Дата оплаты' }, { label: 'Сумма, ₽', num: true }, ...(foreignInvoice(invoice) ? [{ label: 'Погашено по счёту', num: true }] : []), { label: 'Состояние' }], groups: [{ rows: records.map(payment => ({
      cells: [date(payment.date), money(payment.amount), ...(foreignInvoice(invoice) ? [sourceMoney(payment.sourceAmount, invoice)] : []), payment.state === 'voided' ? 'Сторнирована' : 'Учтена'],
      expand: () => stack(h('p', null, payment.note || 'Без примечания'), h('p', { class: 'hint' }, `Зарегистрировано: ${dateTime(payment.createdAt)}. Подтверждений: ${(payment.fileIds || []).length}.`, payment.voidReason ? ' Причина сторно: ' + payment.voidReason : ''),
        payment.files?.length ? actions(...payment.files.map(file => link({ label: file.name || 'Подтверждение оплаты', href: /^https?:\/\//.test(file.url || '') ? file.url : PREFIX + (file.url || '') }))) : null,
        p.unpay && payment.state !== 'voided' ? actions(button({ label: 'Сторнировать ошибочную оплату', kind: 'danger', onClick: () => voidPayment(invoice, payment, ctx) })) : null),
    })) }], empty: { title: invoice.reconciliationRequired ? 'Требуется сверка старой оплаты' : invoice.paymentSource === 'legacy' ? 'Оплата сохранена в прежнем учёте' : 'Оплат пока нет', hint: invoice.reconciliationRequired ? invoice.reconciliationReason || 'Проверьте документы оплаты; сведения источников расходятся.' : invoice.paymentSource === 'legacy' ? 'Старые факты не переносятся автоматически при открытии карточки.' : 'Добавьте оплату после подтверждения перечисления денег.' } })); loadMore.hidden = Number(invoice.paymentsTotal || 0) <= records.length; };
  render();
  return section({ title: 'Фактические оплаты', count: invoice.paymentsTotal ?? records.length, body: [h('p', { class: 'hint' }, 'Каждая оплата учитывается в свой фактический день. Время регистрации и сторно сохраняются в истории.'), historyBox, actions(loadMore)] });
}

/** Только разрешённые read-model файлы текущего подтверждения; скрытые счета не догружаем по ID. */
function undatedEvidenceBlock(invoice) {
  const evidence = invoice.undatedPaymentEvidence;
  if (!session.canMoney || invoice.partial || !evidence) return null;
  const pending = needsPaymentDate(invoice);
  const allowed = new Set((evidence.fileIds || []).map(String));
  const files = (evidence.files || []).filter(file => allowed.has(String(file.id)));
  const links = files.map(file => {
    const url = String(file.url || '');
    if (!/^\/uploads\/[^\\\s]+$/.test(url) && !/^https?:\/\/[^\\\s]+$/i.test(url)) return null;
    return link({ label: file.name || 'Открыть подтверждение оплаты', href: fileUrl(url), target: '_blank' });
  }).filter(Boolean);
  return section({ title: 'Подтверждение оплаты без даты', open: pending, body: [
    h('p', null, evidence.reason || ''),
    h('p', { class: 'hint' }, `Подтверждено: ${dateTime(evidence.confirmedAt)}. ${pending ? 'Уточните фактическую дату; денежной операции пока нет.' : evidence.state === 'revoked' ? 'Подтверждение отозвано. ' + (evidence.revokeReason || '') : 'Дата заполнена, оплата учтена.'}`),
    links.length ? actions(...links) : null,
    allowed.size > links.length ? h('p', { class: 'hint' }, 'Часть файлов подтверждения недоступна. Обновите счёт или уточните доступ к документу.') : null,
  ] });
}

function body(invoice, ctx, notes = []) {
  if (invoice._refreshError) return failBlock(invoice._refreshError, () => ctx.reload(), { text: 'Сохранено, но обновить показ не удалось. Повторить только загрузку' });
  const p = permissions(invoice, session), checks = p.receive ? new Map() : null;
  checksOf.set(invoice, checks);
  const adjustments = session.canMoney ? invoice.paymentAdjustments || [] : [];
  const orders = (invoice.orders || []).map((order) => typeof order === 'object' ? order : { productionNo: order });
  return h('div', { 'data-invoice-workspace': invoice.id, class: 'iw-screen' },
    section({ title: 'Позиции', count: (invoice.requests || []).length, open: true, body: [
      positions(invoice, ctx, { receiveChecks: checks }),
      checks ? actions(
        button({ label: 'Принять на склад', onClick: () => command(invoice, ctx, 'receive', null, { requestIds: markedIds(invoice) }) }),
        button({ label: 'Принять на объект', onClick: () => receiveOnObject(invoice, ctx) }),
      ) : null,
      addPicker(invoice, ctx),
      newRequestBar(invoice, ctx),
    ] }),
    ...notes,
    undatedEvidenceBlock(invoice),
    metaBlock(invoice, ctx, refreshInvoice),
    paymentHistory(invoice, ctx),
    orders.length ? section({ title: 'Связанные заказы', body: table({ label: 'Заказы', columns: [{ label: 'Заказ' }, { label: 'Договоры' }], rows: orders.map((order) => ({ cells: [`№ ${order.productionNo || '—'}`, (order.contracts || []).join(', ') || '—'] })) }) }) : null,
    session.canMoney && invoice.paymentSnapshot ? section({ title: 'Оплата и корректировки', count: adjustments.length, body: [
      h('p', { class: 'hint' }, 'Исходный платёж неизменяем. Корректировки меняют текущую сумму строк.'),
      table({ label: 'Корректировки', columns: [{ label: 'Дата' }, { label: 'Причина', cls: 'clip' }, { label: 'Изменение', num: true }],
        rows: adjustments.map((a) => ({ cells: [date(a.at), a.reason, money(a.delta)] })),
        empty: { title: 'Корректировок пока нет', hint: 'Здесь появятся причины изменения оплаченного счёта.' } }),
    ] }) : null);
}

/** Одна главная кнопка по этапу счёта; остальные команды — в «⋯». */
function steps(invoice, ctx) {
  const p = permissions(invoice, session);
  const all = [
    p.issue && { key: 'issue', label: 'Выставить счёт', text: 'Сначала проверьте реквизиты, затем выставьте счёт.', run: () => command(invoice, ctx, 'issue') },
    p.pay && { key: 'pay', label: p.dateRequired ? 'Заполнить дату' : 'Добавить оплату', text: p.dateRequired ? 'Оплата подтверждена — заполнить дату перечисления по документу.' : 'Внесите подтверждённую сумму и фактическую дату. Авансы и доплаты сохраняются отдельно.', run: () => command(invoice, ctx, 'pay') },
  ].filter(Boolean);
  return { main: all[0] || null, rest: all.slice(1) };
}

const invoiceFacts = (invoice) => [
  [invoice.partial ? 'Видимых позиций' : 'Позиций', (invoice.requests || []).length],
  invoice.payerName ? ['Наша компания', invoice.payerName] : null,
  session.canMoney && (invoice.paidAmount != null || invoice.reconciliationRequired) ? ['Фактически оплачено', invoice.paidAmount == null ? 'Требует сверки' : money(invoice.paidAmount)] : null,
  session.canMoney && invoice.paymentState ? ['Оплата', paymentStateLabel(invoice)] : null,
  session.canMoney && needsPaymentDate(invoice) ? ['Подтверждено без даты', money(invoice.undatedConfirmedAmountRub)] : session.canMoney && invoice.reconciliationRequired ? ['Остаток', 'Требует сверки'] : session.canMoney && foreignInvoice(invoice) ? ['Остаток по документу', sourceMoney(invoice.sourceBalance, invoice)] : session.canMoney && invoice.balanceDue !== undefined ? ['Остаток, ₽', invoice.balanceDue == null ? 'Нужен пересчёт' : money(invoice.balanceDue)] : null,
].filter(Boolean);

const invoiceStage = (invoice) => invoice._refreshError ? null : needsPaymentDate(invoice) ? badge('Требует даты оплаты', 'warn') : invoice.reconciliationRequired || invoice.paymentState === 'reconciliation' ? badge('Требует сверки', 'warn') : badge(INVOICE_STATUS, invoice.status);
const invoiceAmount = (invoice) => session.canMoney && !invoice._refreshError ? h('b', null, invoice.accountingState === 'unresolved' ? sourceMoney(invoice.sourceAmount, invoice) + ' · Нужен пересчёт' : money(invoice.amount)) : null;

export const invoiceCard = {
  id: 'invoicecard', title: 'Счёт поставщика', kind: 'Счёт', noun: 'счёт', entityType: 'SupplyInvoice',
  canEdit: () => session.canEdit,
  get: async id => { const invoice = await getInvoice(id); const operation = takeInvoiceOperation(id); return operation ? { ...invoice, _operation: operation } : invoice; },
  // Карточка по эталону заказа (C119 шаг 3): шапка — счёт, поставщик · дата, этап и сумма; позиции сразу под шапкой; команды — в «⋯»
  card: {
    ...screenCard({
      title: (invoice) => invoice.no ? `Счёт № ${invoice.no}` : 'Счёт без номера',
      sub: (invoice) => [invoice.supplierName || 'Поставщик не указан', invoice.date ? date(invoice.date) : ''].filter(Boolean).join(' · '),
      stage: invoiceStage,
      side: (invoice) => [invoiceAmount(invoice), invoice.partial ? 'только видимые строки' : null],
      noHistory: true,
      bodyFirst: true,
      warns: (invoice) => invoiceWarnings(invoice, session),
      next: (invoice, ctx) => {
        if (invoice._refreshError) return null;
        const { main } = steps(invoice, ctx);
        return main ? { text: main.text, primary: { label: main.label, run: main.run } } : null; // нет шага — «Что дальше» не показываем
      },
      facts: (invoice) => (invoice._refreshError ? [] : invoiceFacts(invoice)),
      body: (invoice, ctx, notes) => body(invoice, ctx, notes),
      menu: (invoice, ctx) => {
        if (invoice._refreshError) return [{ label: 'Обновить', run: () => ctx.reload() }];
        const p = permissions(invoice, session);
        return [
          { label: 'Обновить', run: () => ctx.reload() },
          p.meta ? { label: 'Реквизиты счёта', run: () => ctx.edit({ _operation: 'meta' }) } : null,
          ...steps(invoice, ctx).rest.map((s) => ({ label: s.label, run: s.run })),
          p.confirmUndated ? { label: 'Подтвердить оплату без даты', run: () => ctx.edit({ _operation: 'undated' }) } : null,
          p.revokeUndated ? { label: 'Отозвать подтверждение без даты', danger: true, run: () => ctx.edit({ _operation: 'revokeUndated' }) } : null,
          p.unpay && invoice.paymentAccountingVersion !== 1 ? { label: 'Снять оплату', danger: true, run: () => override(invoice, ctx, 'unpay') } : null,
        ];
      },
    }),
    // Штатный wrap kit.actions сохраняет статус и полную сумму при длинном номере и в форме.
    headStats: invoice => invoice._refreshError ? null : actions(invoiceStage(invoice), invoiceAmount(invoice)),
    editTitle: invoice => invoice.no ? `Счёт № ${invoice.no}` : 'Счёт без номера',
    // Реквизиты и позиции — на одном экране в body; нижняя «Реквизиты счёта» не нужна.
    startEdit: invoice => invoice._operation === 'payment' && permissions(invoice, session).pay,
    editable: () => false,
    editLabel: 'Реквизиты счёта',
  },
  form: {
    build: async (base, ctx) => {
      const fresh = await getInvoice(base.id);
      return buildWorkspaceForm(fresh, { operation: base._operation || 'meta', lineId: base._lineId }, {
        candidates: getCandidates, payers: getPayers, contracts: getContracts, href: workspaceHref, refresh: () => ctx.reload(), edit: (draft) => ctx.edit(draft),
        overview: (invoice) => positions(invoice, ctx, { commands: false, editable: false }),
      });
    },
    toBody: (values) => values,
    update: async (id, values) => {
      await writeInvoice(values.invoice, session, values.operation, values.body, values.lineId);
      try { return await getInvoice(id); }
      catch (error) { return { id, _refreshError: error }; }
    },
  },
};
