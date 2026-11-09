import { h } from '../core/dom.js';
import { api, PREFIX, session } from '../core/api.js';
import { current } from '../core/router.js';
import { date, money, qty } from '../core/format.js';
import { readonlyGroup, section, table, button, actions, badge, INVOICE_STATUS, SUPPLY_STATUS, confirmDlg, failBlock, toast, toastError, attachCombo, photoField, enhanceSelect } from '../ui/kit/index.js';
import { permissions, lineAmount, pendingLines, assertOperation, lineDraft, changeLine, lineBody, metaBody, addBody } from './invoice-workspace-state.js';
import { adminAction } from './admin-override.js';
import { getInvoice, getCandidates, getBusyRequests, getPayers, getContracts, writeInvoice, deleteInvoice } from './invoice-workspace-api.js';
import { buildWorkspaceForm } from './invoice-workspace-forms.js';

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

/** Inline-ячейка: клик → ввод, Enter/blur → сохранение строки счёта. */
function inlineField(invoice, ctx, line, key, { format, suffix = '', step = 'any' } = {}) {
  const wrap = h('div', { class: 'iw-inline' });
  let draft = lineDraft(line);
  let unitEdited = key === 'unitPrice';
  let busy = false;
  const origin = () => lineDraft(line);
  const show = () => {
    const label = format(draft);
    wrap.replaceChildren(h('button', {
      type: 'button', class: 'iw-inline-btn num', title: 'Изменить',
      'aria-label': (key === 'qty' ? 'Количество' : key === 'unitPrice' ? 'Цена за единицу' : 'Сумма строки') + ': ' + label,
      onclick: () => edit(),
    }, label, suffix ? h('span', { class: 'iw-inline-suf muted' }, ' ' + suffix) : null));
  };
  const refreshSiblings = () => {
    wrap.closest('tr')?.querySelectorAll('[data-iw-key]').forEach((el) => {
      if (el === wrap) return;
      el.dispatchEvent(new CustomEvent('iw-sync', { detail: { draft, unitEdited } }));
    });
  };
  const save = async (next) => {
    const same = next.qty === origin().qty && next.lineAmount === origin().lineAmount;
    if (same) { draft = origin(); show(); return; }
    busy = true; wrap.classList.add('is-busy');
    try {
      assertOperation(invoice, session, 'line', line.id);
      const body = lineBody(invoice, next);
      const ok = await ctx.run(async () => {
        await writeInvoice(invoice, session, 'line', body, line.id);
        toast('Позиция обновлена');
        ctx.changed();
        await refreshInvoice(invoice, ctx);
      });
      if (!ok) { draft = origin(); show(); }
    } catch (error) { toastError(error); draft = origin(); show(); }
    finally { busy = false; wrap.classList.remove('is-busy'); }
  };
  const edit = () => {
    if (busy) return;
    const inp = h('input', {
      type: 'number', class: 'iw-inline-inp num', min: '0', step, inputmode: 'decimal',
      value: draft[key], 'aria-label': key === 'qty' ? 'Количество' : key === 'unitPrice' ? 'Цена за единицу' : 'Сумма строки',
    });
    let done = false;
    const finish = async (commit) => {
      if (done || busy) return; done = true;
      if (!commit) { draft = origin(); show(); return; }
      if (key === 'unitPrice') unitEdited = true;
      if (key === 'lineAmount') unitEdited = false;
      draft = changeLine(draft, key, inp.value, key === 'unitPrice' || (key === 'qty' && unitEdited));
      refreshSiblings();
      await save(draft);
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); done = true; draft = origin(); show(); }
    });
    inp.addEventListener('blur', () => finish(true));
    wrap.replaceChildren(inp, suffix ? h('span', { class: 'iw-inline-suf muted' }, ' ' + suffix) : null);
    inp.focus(); inp.select();
  };
  wrap.dataset.iwKey = key;
  wrap.addEventListener('iw-sync', (e) => { draft = e.detail.draft; unitEdited = e.detail.unitEdited; show(); });
  show();
  return wrap;
}

function positions(invoice, ctx, { editable = true, commands = true, receiveChecks } = {}) {
  const p = permissions(invoice, session);
  const canInline = editable && p.editLine;
  const columns = [{ label: 'Позиция', cls: 'clip' }, { label: 'Количество', num: true },
    ...(session.canMoney ? [{ label: 'Цена / ед.', num: true }, { label: 'Сумма строки', num: true }] : []), { label: 'Статус' },
    ...(editable && commands && (p.removeLine || p.rollback) ? [{ label: 'Действия' }] : [])];
  if (receiveChecks) columns.unshift({ label: 'Принять' });
  const rows = (invoice.requests || []).map((line) => {
    const mutable = !line.deletedAt && !['received', 'cancelled'].includes(line.status);
    const inline = canInline && mutable;
    // принятую позицию администратор переоценивает (цена, сумма), количество — уже на складе
    const priceInline = canInline && !line.deletedAt && line.status !== 'cancelled';
    const sum = lineAmount(line);
    const qtyCell = inline
      ? inlineField(invoice, ctx, line, 'qty', { format: (d) => qty(d.qty), suffix: line.unit || '', step: 'any' })
      : `${qty(line.qty)} ${line.unit || ''}`.trim();
    const priceCell = !session.canMoney ? null : priceInline
      ? inlineField(invoice, ctx, line, 'unitPrice', { format: (d) => Number(d.qty) > 0 ? money(Number(d.lineAmount) / Number(d.qty)) : '—', step: '0.01' })
      : (Number(line.qty) > 0 ? money(sum / Number(line.qty)) : '—');
    const sumCell = !session.canMoney ? null : priceInline
      ? inlineField(invoice, ctx, line, 'lineAmount', { format: (d) => money(d.lineAmount), step: '0.01' })
      : money(sum);
    const controls = editable && commands && p.removeLine && mutable
      ? actions(button({ label: 'Убрать', kind: 'ghost', onClick: () => command(invoice, ctx, 'remove', line.id) }))
      : editable && commands && p.rollback && line.status === 'received'
        ? actions(button({ label: 'Отменить приёмку', kind: 'danger', onClick: () => override(invoice, ctx, 'rollback', line) }))
        : null;
    // Название позиции — текст, без перехода в раздел заявок (один экран счёта).
    const cells = [h('span', { class: 'clip', title: lineTitle(line) }, lineTitle(line)),
      qtyCell, ...(session.canMoney ? [priceCell, sumCell] : []), badge(SUPPLY_STATUS, line.status === 'ordered' && line.paid ? 'paid' : line.status),
      ...(controls ? [controls] : editable && commands && (p.removeLine || p.rollback) ? [''] : [])];
    if (receiveChecks) {
      const cb = mutable ? h('input', { type: 'checkbox', checked: true, 'aria-label': 'Принять ' + lineTitle(line) }) : null;
      if (cb) receiveChecks.set(line.id, cb);
      cells.unshift(cb);
    }
    return { data: line.id, cells };
  });
  return table({ label: 'Позиции счёта', columns, rows, maxHeight: 'L', empty: { title: 'В счёте пока нет позиций', hint: p.add ? 'Добавьте заявку полем «+» под таблицей.' : 'Этот счёт доступен только для просмотра.' } });
}

/** Администратор: снять оплату со счёта или отменить приёмку позиции (окно с последствиями и причиной). */
async function override(invoice, ctx, kind, line) {
  try {
    const path = kind === 'unpay' ? `/supply/invoices/${invoice.id}/unpay` : `/supply/requests/${line.id}/rollback-receipt`;
    const done = await adminAction(path, kind === 'unpay'
      ? { title: 'Снять оплату со счёта?', okText: 'Снять оплату', lead: 'Счёт вернётся в «Выставлен», деньги уйдут из календаря оплат. Запись о снятии сохранится.' }
      : { title: 'Отменить приёмку?', okText: 'Отменить приёмку', lead: `Позиция «${lineTitle(line)}» уйдёт со склада и вернётся на прежний этап.` });
    if (!done) return;
    toast(kind === 'unpay' ? 'Оплата снята' : 'Приёмка отменена');
    ctx.changed();
    await ctx.reload();
  } catch (error) { toastError(error); }
}

async function command(invoice, ctx, operation, lineId, body = {}) {
  try {
  assertOperation(invoice, session, operation, lineId);
  const titles = { remove: 'Убрать позицию из счёта?', issue: 'Выставить счёт?', pay: 'Отметить счёт оплаченным?', receive: 'Принять отмеченные позиции на склад?' };
  const notes = { remove: 'Заявка останется и вернётся в «Заказать». Сумма счёта пересчитается.', issue: 'Сначала сохраните реквизиты. Это отдельное выставление счёта, без оплаты.', pay: 'Будет зафиксирован факт оплаты полного счёта. Реквизиты и позиции эта команда не сохраняет.', receive: 'Будут приняты только отмеченные позиции. Первая приёмка зафиксирует финансы всего счёта.' };
  if (operation === 'receive' && !body.requestIds?.length) { toast('Отметьте позиции, которые приехали', { error: true }); return; }
  if (!(await confirmDlg(titles[operation], notes[operation], { okText: operation === 'remove' ? 'Убрать' : 'Подтвердить', danger: operation === 'remove' }))) return;
  await ctx.run(async () => {
    await writeInvoice(invoice, session, operation, body, lineId);
    toast({ remove: 'Позиция убрана', issue: 'Счёт выставлен', pay: 'Счёт оплачен', receive: 'Позиции приняты на склад' }[operation]);
    ctx.changed();
    await refreshInvoice(invoice, ctx);
  });
  } catch (error) { toastError(error); }
}

/** Реквизиты на том же экране: поля + выпадающие списки, сохранение по blur / смене. */
function metaBlock(invoice, ctx) {
  const p = permissions(invoice, session);
  if (!p.meta) {
    return readonlyGroup({ title: 'Реквизиты', rows: [
      ['№ счёта', invoice.no || 'Без номера'], ['Дата', invoice.date ? date(invoice.date) : 'Не указана'],
      ['Наша компания', invoice.payerName || '—'],
      ['Договор', invoice.contractNo ? `№ ${invoice.contractNo}` : 'Без договора'],
    ] });
  }
  const no = h('input', { name: 'no', value: invoice.no || '', maxlength: 100, 'aria-label': '№ счёта' });
  const dateInp = h('input', { name: 'date', type: 'date', value: String(invoice.date || '').slice(0, 10), 'aria-label': 'Дата счёта' });
  const payer = enhanceSelect(h('select', { name: 'payerCompanyId', 'aria-label': 'Наша компания', disabled: !p.payer }, h('option', { value: '' }, 'Выберите компанию')));
  const contract = enhanceSelect(h('select', { name: 'contractId', 'aria-label': 'Договор' }, h('option', { value: '' }, 'Без договора')));
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
        no: no.value, date: dateInp.value, payerCompanyId: payer.value, contractId: contract.value, fileIds: fileIds(),
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
    h('div', { class: 'iw-files' }, h('div', { class: 'muted small' }, 'Файлы счёта'), files.el),
  ] });
}

/** Поле «+» → выпадающий список заявок; выбор сразу добавляет в счёт. */
function addPicker(invoice, ctx) {
  const p = permissions(invoice, session);
  if (!p.add) return null;
  let cache = [];
  const input = h('input', { type: 'search', class: 'iw-add-inp', placeholder: 'Добавить заявку…', 'aria-label': 'Добавить существующую заявку в счёт', autocomplete: 'off' });
  const wrap = h('div', { class: 'iw-add has-combo' }, h('span', { class: 'iw-add-plus', 'aria-hidden': 'true' }, '+'), input);
  const fromName = (f) => `счёт ${f.no ? '№' + f.no : 'без номера'}${f.status && INVOICE_STATUS[f.status] ? ' · ' + INVOICE_STATUS[f.status].label.toLowerCase() : ''}`;
  const load = async (q = '') => {
    try {
      const [r, busy] = await Promise.all([getCandidates(invoice, { page: 1, q, limit: 80 }), getBusyRequests(invoice, { q }).catch(() => [])]);
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
        const emptyAfter = !!o.from && Array.isArray(o.from.requests)
          && o.from.requests.filter((r) => !r.deletedAt && r.status !== 'cancelled' && String(r.id) !== String(o.value)).length === 0;
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
  input.addEventListener('focus', () => { load(input.value.trim()).then(() => input.dispatchEvent(new Event('click'))); });
  input.addEventListener('input', () => { const q = input.value.trim(); clearTimeout(input._t); input._t = setTimeout(() => load(q), 220); });
  load();
  return h('div', { class: 'iw-add-row' }, wrap, h('p', { class: 'hint' }, 'Клик по полю — список заявок. Выбор сразу добавляет позицию в счёт; заявку из другого счёта — переносит сюда.'));
}

/** Компактная форма новой заявки внизу экрана счёта — без перехода в раздел «Заявки». */
function newRequestBar(invoice, ctx) {
  const p = permissions(invoice, session);
  if (!p.add) return null;
  const panel = h('div', { class: 'iw-new', hidden: true });
  const title = h('input', { name: 'title', maxlength: 500, placeholder: 'Название позиции', 'aria-label': 'Название новой заявки' });
  const qtyInp = h('input', { name: 'qty', type: 'number', min: '0', step: 'any', value: '1', inputmode: 'decimal', 'aria-label': 'Количество' });
  const unit = h('input', { name: 'unit', maxlength: 40, value: 'шт', 'aria-label': 'Единица' });
  const toggle = button({ label: '+ Новая заявка', kind: 'ghost', onClick: () => { panel.hidden = !panel.hidden; if (!panel.hidden) title.focus(); } });
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

function summary(invoice) {
  const rows = [['Поставщик', invoice.supplierName || 'Не указан'], ['Статус', badge(INVOICE_STATUS, invoice.status)],
    [invoice.partial ? 'Видимых позиций' : 'Позиций', (invoice.requests || []).length]];
  if (session.canMoney) rows.push([invoice.partial ? 'Сумма видимых строк' : 'Текущая сумма', money(invoice.amount)],
    invoice.paymentSnapshot ? ['Исходный платёж', `${money(invoice.paymentSnapshot.amount)} · ${date(invoice.paymentSnapshot.paidAt)}`] : null);
  return readonlyGroup({ title: 'Сведения', rows });
}

function details(invoice, ctx) {
  if (invoice._refreshError) return failBlock(invoice._refreshError, () => ctx.reload(), { text: 'Сохранено, но обновить показ не удалось. Повторить только загрузку' });
  const p = permissions(invoice, session), checks = p.receive ? new Map() : null;
  const topActions = actions(
    button({ label: 'Обновить', kind: 'ghost', onClick: () => ctx.reload() }),
    p.issue ? button({ label: 'Выставить счёт', onClick: () => command(invoice, ctx, 'issue') }) : null,
    p.pay ? button({ label: 'Счёт оплачен', kind: 'primary', onClick: () => command(invoice, ctx, 'pay') }) : null,
    p.unpay ? button({ label: 'Снять оплату', kind: 'danger', onClick: () => override(invoice, ctx, 'unpay') }) : null);
  const adjustments = session.canMoney ? invoice.paymentAdjustments || [] : [];
  const orders = (invoice.orders || []).map((order) => typeof order === 'object' ? order : { productionNo: order });
  return h('div', { 'data-invoice-workspace': invoice.id, class: 'iw-screen' },
    summary(invoice),
    p.reason ? h('p', { class: 'hint', 'data-invoice-lock': '' }, p.reason) : null,
    topActions,
    metaBlock(invoice, ctx),
    section({ title: 'Позиции', count: (invoice.requests || []).length, open: true, body: [
      positions(invoice, ctx, { receiveChecks: checks }),
      addPicker(invoice, ctx),
      newRequestBar(invoice, ctx),
      checks ? actions(
        h('span', { class: 'hint' }, 'Отметьте только приехавшие позиции.'),
        button({ label: 'Принять на склад', onClick: () => command(invoice, ctx, 'receive', null, { requestIds: [...checks].filter(([, cb]) => cb.checked).map(([id]) => id) }) })) : null,
    ] }),
    orders.length ? section({ title: 'Связанные заказы', body: table({ label: 'Заказы', columns: [{ label: 'Заказ' }, { label: 'Договоры' }], rows: orders.map((order) => ({ cells: [`№ ${order.productionNo || '—'}`, (order.contracts || []).join(', ') || '—'] })) }) }) : null,
    session.canMoney && invoice.paymentSnapshot ? section({ title: 'Оплата и корректировки', count: adjustments.length, body: [
      h('p', { class: 'hint' }, 'Исходный платёж неизменяем. Корректировки меняют текущую сумму строк.'),
      table({ label: 'Корректировки', columns: [{ label: 'Дата' }, { label: 'Причина', cls: 'clip' }, { label: 'Изменение', num: true }],
        rows: adjustments.map((a) => ({ cells: [date(a.at), a.reason, money(a.delta)] })),
        empty: { title: 'Корректировок пока нет', hint: 'Здесь появятся причины изменения оплаченного счёта.' } }),
    ] }) : null);
}

export const invoiceCard = {
  id: 'invoicecard', title: 'Счёт поставщика', kind: 'Счёт', noun: 'счёт', entityType: 'SupplyInvoice',
  canEdit: () => session.canEdit,
  get: getInvoice,
  card: {
    heading: (invoice) => invoice.no ? `Счёт № ${invoice.no}` : 'Счёт без номера',
    subheading: (invoice) => [invoice.date ? date(invoice.date) : '', invoice.supplierName].filter(Boolean).join(' · '),
    noHistory: true, view: () => [],
    // Реквизиты и позиции — на одном экране в extra; нижняя «Реквизиты счёта» не нужна.
    editable: () => false,
    editLabel: 'Реквизиты счёта',
    extra: details,
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
