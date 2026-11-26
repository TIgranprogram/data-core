import { h } from '../core/dom.js';
import { session } from '../core/api.js';
import { money, date } from '../core/format.js';
import { buildForm, section, table, button, actions, link, toast, toastError, autoMore, photoField, badge, SUPPLY_STATUS } from '../ui/kit/index.js';
import { permissions, assertOperation, lineDraft, changeLine, lineBody, addBody, metaBody, foreignInvoice, invoiceCurrency, businessToday, paymentBody, financialMetaBody, needsPaymentDate } from './invoice-workspace-state.js';

import { previewInvoiceMerge } from './invoice-merge-preview.js';

const field = (key, label, input) => ({ key, label, type: 'widget', wide: true, widget: () => ({ el: input, get value() { return JSON.stringify(input.value); }, set value(_) { /* начальное значение уже установлено */ } }) });
const number = (name, value, step = 'any') => h('input', { name, type: 'number', min: '0', step, inputmode: 'decimal', value });


const VAT_MODES = [{ value: 'included', label: 'Включён в сумму' }, { value: 'excluded', label: 'Начислить сверху' }, { value: 'none', label: 'Без НДС' }, { value: 'mixed', label: 'Разные ставки по строкам' }];
const VAT_RATES = [{ value: '', label: 'Не указан' }, ...[0, 5, 7, 10, 20, 22].map(v => ({ value: String(v), label: `${v}%` }))];
const FINANCE_KEYS = ['currencyName', 'exchangeRate', 'exchangeRateDate', 'exchangeRateSource', 'confirmedAmountRub', 'conversionNote'];
function financialFields(invoice) {
  return [
    { section: 'Валюта и пересчёт', tone: 'money' },
    { key: 'currency', label: 'Валюта документа', type: 'select', options: ['RUB', 'USD', 'EUR', 'CNY', 'UE'].map(value => ({ value, label: value === 'RUB' ? 'Рубли' : value === 'UE' ? 'Условные единицы по договору' : value })), mount: api => {
      const sync = () => { const foreign = api.get('currency') !== 'RUB'; for (const k of FINANCE_KEYS) if (api.field(k)) api.field(k).hidden = !foreign || (k === 'currencyName' && api.get('currency') !== 'UE'); };
      api.on('currency', sync); sync();
    } },
    { key: 'currencyName', label: 'Что означает условная единица', max: 100, wide: true, hint: 'Например: единица по пункту договора. Не приравниваем её к доллару без основания.' },
    { key: 'exchangeRate', label: 'Курс, ₽ за единицу', type: 'number', min: 0 },
    { key: 'exchangeRateDate', label: 'Дата курса', type: 'date' },
    { key: 'exchangeRateSource', label: 'Основание курса', max: 300, wide: true },
    { key: 'confirmedAmountRub', label: 'Подтверждённый итог в рублях', type: 'money', min: 0, hint: 'Если есть точная рублёвая сумма в банковском документе или переписке' },
    { key: 'conversionNote', label: 'Основание рублёвого итога', type: 'textarea', max: 1000, wide: true },
    { section: 'НДС документа', tone: 'money' },
    { key: 'vatMode', label: 'Как указан НДС', type: 'select', options: [{ value: '', label: 'Не указан — сверить первичку' }, ...VAT_MODES], hint: 'Неизвестный НДС можно уточнить позже. «Без НДС» выбирайте только по документу.' },
    { key: 'vatRate', label: 'Ставка НДС', type: 'select', options: VAT_RATES, hint: 'Для включённого НДС и начисления сверху ставка обязательна. 0% отличается от «Без НДС».' },
    { key: 'declaredVatAmount', label: 'НДС по первичке, в валюте документа', type: 'number', min: 0, hint: 'В исходной валюте документа; неизвестное оставьте пустым.' },
  ];
}

/** Одна явная форма оплаты для всех входов. Ключ и тело сохраняются после потерянного ответа. */
async function buildPaymentForm(invoice, services) {
  const payers = await services.payers();
  if (invoice.payerCompanyId && !payers.some(x => String(x.value) === String(invoice.payerCompanyId))) payers.push({ value: invoice.payerCompanyId, label: invoice.payerName || 'Текущая компания' });
  const files = photoField([], { pdf: true });
  const foreign = foreignInvoice(invoice);
  const pending = needsPaymentDate(invoice);
  const form = buildForm([
    { section: pending ? 'Заполнить дату подтверждённой оплаты' : 'Добавить фактическую оплату', fixed: true },
    ...(pending ? [{ note: 'Полная оплата подтверждена, но ещё не включена в денежный отчёт. Укажите день перечисления по документу. Сумма и плательщик сохранены из подтверждения.' }] : []),
    !pending ? { note: 'Дата оплаты — день перечисления денег, а не дата ввода. Можно внести старую оплату или аванс; товар от этого не считается полученным.' } : null,
    pending ? { key: 'payerCompanyId', type: 'hidden' } : { key: 'payerCompanyId', label: 'Наша компания — плательщик', type: 'select', required: true, options: [{ value: '', label: 'Выберите компанию' }, ...payers] },
    ...(pending ? [{ note: `Плательщик: ${payers.find(p => String(p.value) === String(invoice.undatedPaymentEvidence?.payerCompanyId || invoice.payerCompanyId))?.label || invoice.payerName || 'Указанная наша компания'}. Подтверждено: ${money(invoice.undatedConfirmedAmountRub)}.` }] : []),
    { key: 'date', label: 'Фактическая дата оплаты', type: 'date', required: true },
    pending ? { key: 'amount', type: 'hidden' } : { key: 'amount', label: 'Фактически уплачено, ₽', type: 'money', required: true, min: 0 },
    foreign ? { key: 'sourceAmount', label: `Погашено по счёту, ${invoiceCurrency(invoice)}`, type: 'number', required: true, min: 0, hint: 'Рублёвый платёж и погашение исходного обязательства сохраняются отдельно.' } : null,
    { section: 'Подтверждение оплаты', tone: 'info' },
    { key: 'note', label: 'Примечание / основание', type: 'textarea', max: 1000, wide: true },
    { key: 'fileIds', label: 'Платёжный документ или подтверждение', type: 'widget', wide: true, widget: () => ({ el: files.el, get value() { return JSON.stringify(files.ids()); }, set value(_) {} }) },
  ].filter(Boolean), { date: pending ? '' : businessToday(), payerCompanyId: String(invoice.undatedPaymentEvidence?.payerCompanyId || invoice.payerCompanyId || ''), amount: pending ? invoice.undatedConfirmedAmountRub : foreign ? '' : invoice.balanceDue ?? invoice.amount ?? '', sourceAmount: foreign ? invoice.sourceBalance ?? '' : '', note: '' });
  const uid = globalThis.crypto?.randomUUID?.() || `payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let submitted;
  return { ...form, rejectSubmission: () => { submitted = undefined; }, busy: () => !!files.el.querySelector('.photo-drop.busy'), lockSubmission: () => { if (submitted) form.el.querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = true; }); }, payload: () => {
    if (submitted) return submitted;
    const read = form.read(); if (read.errors) return null;
    submitted = Object.freeze(paymentBody(invoice, { ...read.values, ...(pending ? { amount: invoice.undatedConfirmedAmountRub, payerCompanyId: invoice.undatedPaymentEvidence?.payerCompanyId || invoice.payerCompanyId } : {}), fileIds: files.ids() }, uid));
    return submitted;
  } };
}

/** Подтверждение без даты не создаёт денежную операцию. UID и тело переживают потерянный ответ. */
function buildUndatedForm(invoice, revoke) {
  const files = revoke ? null : photoField([], { pdf: true });
  const form = buildForm([
    { section: revoke ? 'Отозвать подтверждение оплаты' : 'Оплата подтверждена, дата неизвестна', fixed: true },
    { note: revoke ? 'Счёт снова станет обязательством к оплате. Отзыв сохраняется в истории; денежной операции здесь нет.' : 'Подтверждайте только известную полную оплату рублёвого счёта. Расход появится в отчётах после заполнения фактической даты. Товар не считается полученным.' },
    { note: `Сумма: ${money(revoke ? invoice.undatedConfirmedAmountRub : invoice.amount)}. Плательщик: ${invoice.payerName || 'Указанная наша компания'}.` },
    { key: 'reason', label: revoke ? 'Причина отзыва' : 'Основание подтверждения полной оплаты', type: 'textarea', required: true, min: 3, max: 1000, wide: true },
    files ? { key: 'fileIds', label: 'Документ или переписка с подтверждением', type: 'widget', wide: true, widget: () => ({ el: files.el, get value() { return JSON.stringify(files.ids()); }, set value(_) {} }) } : null,
  ].filter(Boolean), { reason: '' });
  const clientUid = globalThis.crypto?.randomUUID?.() || `undated-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let submitted;
  return { ...form, busy: () => !!files?.el.querySelector('.photo-drop.busy'), rejectSubmission: () => { submitted = undefined; }, lockSubmission: () => { if (submitted) form.el.querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = true; }); }, payload: () => {
    if (submitted) return submitted;
    const read = form.read(); if (read.errors) return null;
    const reason = String(read.values.reason || '').trim(); if (reason.length < 3) throw new Error('Укажите основание: не менее трёх символов');
    submitted = Object.freeze({ clientUid, version: Number(invoice.version ?? 0), reason, ...(files ? { fileIds: files.ids() } : {}) }); return submitted;
  } };
}

/** Сумма строки каноническая; изменение qty само по себе не умножает округлённую цену. */
export function buildLineForm(invoice, line) {
  let draft = lineDraft(line), unitEdited = false;
  const inputs = { qty: number('qty', draft.qty), unitPrice: number('unitPrice', draft.unitPrice, '0.01'), lineAmount: number('lineAmount', draft.lineAmount, '0.01') };
  if (invoice.status === 'paid') inputs.reason = h('input', { name: 'reason', maxlength: 500, value: '', placeholder: 'Почему изменился оплаченный счёт' });
  for (const key of ['qty', 'unitPrice', 'lineAmount']) inputs[key].addEventListener('input', () => {
    if (key === 'unitPrice') unitEdited = true;
    if (key === 'lineAmount') unitEdited = false;
    draft = changeLine(draft, key, inputs[key].value, unitEdited);
    for (const other of ['unitPrice', 'lineAmount']) if (other !== key) inputs[other].value = draft[other];
  });
  const source = foreignInvoice(invoice);
  if (source) {
    inputs.sourceUnitPrice = number('sourceUnitPrice', line.sourceUnitPrice ?? '', 'any'); inputs.sourceLineAmount = number('sourceLineAmount', line.sourceLineAmount ?? '', '0.01');
    inputs.sourceUnitPrice.addEventListener('input', () => { const price = Number(inputs.sourceUnitPrice.value); const count = Number(inputs.qty.value); if (inputs.sourceUnitPrice.value.trim() && Number.isFinite(price * count)) inputs.sourceLineAmount.value = String(Math.round(price * count * 100) / 100); });
  }
  const form = buildForm([
    { section: 'Изменить одну позицию', fixed: true },
    { note: `${line.title || line.materialName || 'Позиция'} · ${line.unit || ''}. Сохранение изменит только эту строку.` },
    field('qty', 'Количество', inputs.qty), ...(!source ? [field('unitPrice', 'Цена за единицу, ₽', inputs.unitPrice), field('lineAmount', 'Общая сумма, ₽', inputs.lineAmount)] : []),
    ...(source ? [field('sourceUnitPrice', `Цена первички, ${invoiceCurrency(invoice)}`, inputs.sourceUnitPrice), field('sourceLineAmount', `Сумма строки первички, ${invoiceCurrency(invoice)}`, inputs.sourceLineAmount)] : []),
    !permissions(invoice, session).boundary ? { key: 'vatMode', label: 'НДС строки', type: 'select', options: [{ value: '', label: 'Как в документе' }, ...VAT_MODES.filter(x => x.value !== 'mixed')] } : null,
    !permissions(invoice, session).boundary ? { key: 'vatRate', label: 'Ставка строки', type: 'select', options: VAT_RATES } : null,
    !permissions(invoice, session).boundary ? { key: 'declaredVatAmount', label: `НДС строки по первичке, ${invoiceCurrency(invoice)}`, type: 'number', min: 0 } : null,
    inputs.reason ? field('reason', 'Причина корректировки *', inputs.reason) : null,
    { note: 'Общая сумма — за всё количество этой позиции. Цена за единицу её пересчитает; если меняете только количество — общая сумма не меняется.' },
  ].filter(Boolean), { vatMode: line.vatMode || '', vatRate: line.vatRate ?? '', declaredVatAmount: line.declaredVatAmount ?? '' });
  return { ...form, inputs, payload: () => { const read = form.read(); if (read.errors) return null; const draft = Object.fromEntries(Object.entries(inputs).map(([k, input]) => [k, input.value])); const body = lineBody(invoice, draft);
    if (source) { delete body.lineAmount; for (const key of ['sourceUnitPrice', 'sourceLineAmount']) { const raw = String(draft[key]).trim(); if (raw) { const value = Number(raw.replace(',', '.')); if (!Number.isFinite(value) || value < 0) throw new Error('Проверьте цену и сумму исходной строки'); body[key] = value; } } }
    for (const key of ['vatMode', 'vatRate', 'declaredVatAmount']) { const value = read.values[key]; if (value !== '' && value != null) body[key] = key === 'vatMode' ? value : Number(value); }
    return body; } };
}

async function buildMetaForm(invoice, services) {
  const p = permissions(invoice, session);
  const [payers, contracts] = await Promise.all([p.payer ? services.payers() : [], services.contracts(invoice.supplierId)]);
  if (p.payer && invoice.payerCompanyId && !payers.some((payer) => String(payer.value) === String(invoice.payerCompanyId))) payers.push({ value: String(invoice.payerCompanyId), label: invoice.payerName || 'Текущая компания' });
  const files = photoField(invoice.files || [], { pdf: true });
  const knownIds = (invoice.fileIds || (invoice.files || []).map((f) => f.id)).map(String);
  const unseenIds = knownIds.filter((id) => !(invoice.files || []).some((f) => String(f.id) === id));
  const fileIds = () => [...unseenIds, ...files.ids()];
  const widget = { key: 'fileIds', label: 'Файлы счёта', type: 'widget', wide: true, widget: () => ({ el: files.el, get value() { return JSON.stringify(fileIds()); }, set value(_) { /* файлы уже показаны */ } }) };
  const contractOptions = [{ value: '', label: 'Без договора' }, ...contracts.map((c) => ({ value: c.id, label: `№ ${c.no} от ${date(c.date)}` }))];
  if (invoice.contractId && !contracts.some((c) => String(c.id) === String(invoice.contractId))) contractOptions.push({ value: invoice.contractId, label: `№ ${invoice.contractNo || '—'} (текущий)` });
  const deliveryDate = String(invoice.deliveryDate || '').slice(0, 10);
  const note = invoice.note || '';
  const form = buildForm([
    { section: 'Реквизиты счёта', fixed: true },
    !p.boundary ? { key: 'duplicateReason', label: 'Причина отдельного счёта с тем же номером', max: 200, wide: true, hint: 'Только если отдельный счёт с тем же номером действительно нужен.' } : null,
    { key: 'no', label: '№ счёта', max: 100 }, { key: 'date', label: 'Дата счёта', type: 'date' },
    { key: 'deliveryDate', label: 'Дата доставки', type: 'date' },
    { key: 'note', label: 'Примечание', type: 'textarea', max: 1000, wide: true },
    p.payer ? { key: 'payerCompanyId', label: 'Наша компания', type: 'select', required: true, options: [{ value: '', label: 'Выберите компанию' }, ...payers], hint: 'Кто платит: без компании расход не попадёт в «Деньги»' } : null,
    ...(p.finance ? financialFields(invoice) : []),
    { section: 'Договор поставщика', tone: 'info' },
    { key: 'contractId', label: 'Договор', type: 'select', options: contractOptions, wide: true },
    { note: link({ label: 'Создать договор отдельно →', href: services.href({ of: 'contract', new: '1', open: undefined, supplierId: invoice.supplierId }) }) },
    { section: 'Файлы', tone: 'info' }, widget,
    { note: '«Выбрать файл» — отдельная загрузка файла на сервер. К счёту он привяжется только после «Сохранить». Отмена не меняет реквизиты счёта.' },
  ].filter(Boolean), { no: invoice.no || '', date: String(invoice.date || '').slice(0, 10), deliveryDate, note, payerCompanyId: String(invoice.payerCompanyId || ''), contractId: String(invoice.contractId || ''), fileIds: fileIds(), currency: invoice.currency || 'RUB', currencyName: invoice.currencyName || '', exchangeRate: invoice.exchangeRate ?? '', exchangeRateDate: String(invoice.exchangeRateDate || '').slice(0, 10), exchangeRateSource: invoice.exchangeRateSource || '', confirmedAmountRub: invoice.confirmedAmountRub ?? '', conversionNote: invoice.conversionNote || '', vatMode: invoice.vatMode || '', vatRate: invoice.vatRate ?? '', declaredVatAmount: invoice.declaredVatAmount ?? '' });
  const read = () => {
    const result = form.read(); if (result.errors || !p.finance) return result;
    try { financialMetaBody({ ...result.values, fileIds: fileIds() }, invoice); }
    catch (error) { if (!error.field) throw error; const errors = { [error.field]: error.message }; form.markErrors?.([{ key: error.field, message: error.message }]); return { errors }; }
    return result;
  };
  return { ...form, read, busy: () => !!files.el.querySelector('.photo-drop.busy'), payload: () => {
    const result = read(); if (result.errors) return null;
    const draft = { ...result.values, fileIds: fileIds() };
    if ((draft.deliveryDate || '') === deliveryDate) delete draft.deliveryDate;
    if (String(draft.note || '').trim() === note.trim()) delete draft.note;
    return metaBody(invoice, draft, session);
  } };
}

/** Выбор сохраняется в Map между поисками и серверными страницами. */
function buildAddForm(invoice, services) {
  const selected = new Map(); let q = '';
  const results = h('div'), count = h('p', { class: 'hint' });
  const search = h('input', { type: 'search', name: 'candidate-search', placeholder: 'Найти существующую заявку', 'aria-label': 'Поиск заявок' });
  const reason = invoice.status === 'paid' ? h('input', { name: 'reason', maxlength: 500, placeholder: 'Причина — по желанию' }) : null;
  const updateCount = () => { count.textContent = `Выбрано заявок: ${selected.size}. Выбор сохраняется при поиске и подгрузке.`; };
  // ПГ-1c: порции при прокрутке вниз — kit.autoMore; выбор (selected) живёт между порциями и поисками
  const more = autoMore({
    root: results, cls: 'actions', limit: 50, text: { fail: 'Заявки не загрузились', moreFail: 'Не удалось подгрузить заявки' },
    load: (page, { limit }) => services.candidates(invoice, { page, q, limit }),
    render: (items) => {
      results.replaceChildren(table({ label: 'Заявки для добавления', maxHeight: 'M',
        columns: [{ label: 'Выбрать' }, { label: 'Заявка', cls: 'clip' }, { label: 'Количество' }, { label: 'Статус' }],
        rows: items.map((x) => ({ data: x.id, cells: [h('input', { type: 'checkbox', checked: selected.has(x.id), 'aria-label': 'Добавить ' + (x.title || x.num), onchange: (e) => { if (e.target.checked) selected.set(x.id, x); else selected.delete(x.id); updateCount(); } }), x.title || x.materialName || '—', `${x.qty ?? ''} ${x.unit || ''}`, badge(SUPPLY_STATUS, x.status)] })),
        empty: { title: 'Свободных заявок не нашлось', hint: items.length < more.total ? 'Загруженные заявки уже привязаны к счетам — ищем дальше.' : 'Измените поиск или создайте заявку отдельно. В счёт добавляются только непривязанные заявки.' } }));
    },
  });
  const load = () => more.reload();
  const find = () => { q = search.value.trim(); return load(); };
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
  const el = section({ title: 'Добавить существующие заявки', open: true, body: [
    actions(search, button({ label: 'Найти', onClick: find })), count,
    reason ? h('label', { class: 'field' }, h('span', null, 'Причина добавления'), reason) : null,
    results, more.el,
    h('p', { class: 'hint' }, 'Нет нужной позиции — кнопка «Создать заявку» сверху. После создания вернитесь в счёт и добавьте её здесь.'),
  ] });
  updateCount(); load();
  return { el, dirty: () => selected.size > 0 || !!reason?.value.trim(), read: () => ({ values: {} }), busy: () => false,
    payload: () => { if (more.busy) throw new Error('Дождитесь загрузки заявок'); return addBody(invoice, [...selected.keys()], reason?.value || ''); } };
}

/** Регистрация формы в openCard охватывает и обзор, и внутренние смены строки/режима. */
export async function buildWorkspaceForm(invoice, options, services) {
  const operation = options.operation || 'meta', lineId = options.lineId;
  assertOperation(invoice, session, operation, lineId);
  const form = operation === 'line' ? buildLineForm(invoice, invoice.requests.find((x) => x.id === lineId))
    : ['undated', 'revokeUndated'].includes(operation) ? buildUndatedForm(invoice, operation === 'revokeUndated') : operation === 'payment' ? await buildPaymentForm(invoice, services) : operation === 'add' ? buildAddForm(invoice, services) : await buildMetaForm(invoice, services);
  const conflict = h('div', { class: 'form-error', hidden: true });
  let bindSave, conflicted = false, duplicate = false, previewing = false, merged = false;
  const duplicateInput = form.el.querySelector('[name="duplicateReason"]');
  duplicateInput?.addEventListener('input', () => {
    if (!duplicate) return;
    conflicted = !duplicateInput.value.trim(); bindSave?.(!conflicted);
  });
  const p = permissions(invoice, session);
  const createHref = services.href({ of: 'requests', new: '1', open: undefined });
  const el = h('div', { 'data-invoice-operation': operation }, actions(
    p.meta ? button({ label: 'Реквизиты счёта', disabled: operation === 'meta', onClick: () => services.edit?.({ _operation: 'meta' }) }) : null,
    p.add ? button({ label: 'Добавить заявки', disabled: operation === 'add', onClick: () => services.edit?.({ _operation: 'add' }) }) : null,
    p.add ? button({ label: 'Создать заявку', onClick: () => { location.hash = createHref; } }) : null), form.el, conflict,
    section({ title: 'Позиции этого счёта', count: (invoice.requests || []).length, open: true, body: services.overview(invoice) }));
  const previewDuplicate = async (targetId) => {
    if (previewing || merged) return;
    previewing = true;
    try {
      const result = await previewInvoiceMerge(invoice.id, targetId);
      if (!result) return;
      merged = true;
      toast('Позиции объединены с существующим счётом');
      if (el.isConnected) location.hash = services.href({ of: 'invoicecard', open: result.targetInvoiceId || targetId, new: undefined, fill: undefined });
    } catch (error) { toastError(error, 'объединить счета'); }
    finally { previewing = false; }
  };
  return { el, busy: form.busy, dirty: () => !merged && form.dirty(),
    focus: form.focus,
    bindSave: (fn) => { bindSave = fn; if (['payment', 'undated', 'revokeUndated'].includes(operation)) fn(true, operation === 'undated' ? 'Подтвердить без даты' : operation === 'revokeUndated' ? 'Отозвать подтверждение' : 'Сохранить оплату'); },
    read: () => { const read = form.read(); return read.errors ? read : { values: { invoice, operation, lineId, body: form.payload() } }; },
    onError: (e) => {
      if (['payment', 'undated', 'revokeUndated'].includes(operation)) { if (e?.status === 400) form.rejectSubmission?.(); else setTimeout(() => form.lockSubmission?.(), 0); }
      if (e?.status !== 409) return;
      duplicate = operation === 'meta' && !!e?.data?.existingInvoiceId;
      conflicted = true; bindSave?.(false);
      conflict.hidden = false;
      conflict.replaceChildren(h('p', null, duplicate ? 'Такой номер уже существует. Откройте существующий счёт или укажите причину отдельного счёта. Введённые реквизиты сохранены в форме.' : 'Счёт изменился. Ввод сохранён; повторной записи не будет. Сначала обновите счёт.'),
        actions(button({ label: 'Обновить счёт', onClick: services.refresh }),
          duplicate ? link({ label: 'Открыть существующий счёт →', href: services.href({ of: 'invoicecard', open: e.data.existingInvoiceId, new: undefined }) }) : null,
          duplicate && p.meta && !p.paid && !p.ledgerLocked && !p.boundary && !foreignInvoice(invoice) && !['paid', 'cancelled'].includes(e.data.existingStatus)
            ? button({ label: 'Посмотреть, что добавится', onClick: () => previewDuplicate(e.data.existingInvoiceId) }) : null));
    },
    get conflicted() { return conflicted; },
  };
}
