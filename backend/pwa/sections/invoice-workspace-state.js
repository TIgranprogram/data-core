/** Чистые правила workspace: без DOM, сессии и транспорта. Сервер проверяет их повторно. */
export const lineAmount = (line) => Number(line.lineAmount ?? line.priceHint ?? 0);
export const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
export const pendingLines = (invoice) => (invoice.requests || []).filter((r) => !r.deletedAt && !['received', 'cancelled'].includes(r.status));
export const needsPaymentDate = (invoice) => invoice.requiresPaymentDate === true || invoice.paymentState === 'date_required';
export function permissions(invoice, rights) {
  const whole = !invoice.partial;
  const live = invoice.status !== 'cancelled';
  const boundary = !!(invoice.receiptBoundaryAt || invoice.lockReason || (invoice.requests || []).some((r) => r.status === 'received'));
  const meta = !!rights.canEdit && whole && live;
  const dateRequired = needsPaymentDate(invoice);
  const ledgerLocked = dateRequired || !!invoice.financialLocked || (invoice.paymentAccountingVersion === 1 && Number(invoice.paidAmount || 0) > 0);
  const finance = meta && !!rights.canMoney && !boundary && !ledgerLocked;
  const isAdmin = !!(rights.isAdmin || rights.role === 'admin' || rights.user?.isOwner);
  const paid = invoice.status === 'paid';
  // Позиции (добавить / править / убрать) — только админ и только до первой приёмки; оплата счёта не блокирует убрать.
  // Позиции до приёмки — менеджер и админ, как на сервере (решение Б 2026-11-06); из оплаченного убирает только админ.
  const linesAdmin = meta && !boundary && !ledgerLocked;
  // «Наша компания» неоплаченного счёта — и после приёмки: без неё счёт не оплатить
  const payer = meta && !!rights.canMoney && !ledgerLocked && (!boundary || !paid);
  const reconciliation = invoice.reconciliationRequired || invoice.paymentState === 'reconciliation';
  const reason = !whole ? 'Часть строк скрыта другим складом. Доступен только просмотр видимых позиций.'
    : !live ? 'Счёт отменён. Доступен только просмотр.'
      : dateRequired ? 'Оплата подтверждена — заполнить дату. Сумма, плательщик и состав зафиксированы до уточнения даты или отзыва подтверждения.'
      : reconciliation ? invoice.reconciliationReason || 'Требуется сверка старой оплаты. Новая оплата недоступна до проверки источника.'
      : ledgerLocked ? 'Внесена оплата: суммы, НДС, валюта и состав зафиксированы. Новые оплаты доступны; для исправления ошибочного платежа обратитесь к администратору.'
      : boundary ? (isAdmin ? 'По счёту уже есть приёмка. Вы можете исправить цену и сумму позиции; количество принятой позиции меняется отменой приёмки.'
        : 'По счёту уже есть приёмка. Цены исправляет администратор; можно менять номер, дату, файлы и договор.')
        : paid ? 'До первой приёмки позиции можно править; убрать позицию из оплаченного счёта может администратор. Исходный платёж не меняется.' : '';
  // Цену позиции администратор исправляет на любой стадии (решение 2026-11-06); добавить и убрать — только до приёмки.
  return { whole, live, boundary, ledgerLocked, meta: meta && !dateRequired, finance, payer, paid, isAdmin, reason, dateRequired,
    confirmUndated: meta && !!rights.canMoney && !dateRequired && !reconciliation && !foreignInvoice(invoice) && !!invoice.payerCompanyId && Number(invoice.amount) > 0 && !invoice.financialLocked && !invoice.paymentSnapshot && !invoice.paymentsTotal && !(invoice.payments || []).length && !Number(invoice.paidAmount || 0) && !invoice.paidAt && !(invoice.requests || []).some(r => r.paid || r.paidAt) && ['draft', 'issued'].includes(invoice.status),
    revokeUndated: meta && !!rights.canMoney && dateRequired,
    add: linesAdmin && !!rights.canMoney, editLine: meta && !!rights.canMoney && !ledgerLocked && (isAdmin || !boundary), removeLine: linesAdmin && (isAdmin || !paid),
    // ЗЯ-1c: только администратор; сервер повторно проверяет и просит причину.
    unpay: !dateRequired && !reconciliation && isAdmin && !!rights.canMoney && whole && live && (paid || ledgerLocked) && !boundary,
    rollback: isAdmin && !!rights.canMoney && whole && live,
    issue: finance && invoice.status === 'draft',
    pay: !reconciliation && meta && !!rights.canMoney && invoice.status === 'issued',
    receive: meta && ['issued', 'paid'].includes(invoice.status) && pendingLines(invoice).length > 0 };
}
export function lineDraft(line) {
  const sum = lineAmount(line);
  return { qty: String(line.qty ?? ''), lineAmount: String(sum), unitPrice: String(Number(line.qty) > 0 ? roundMoney(sum / Number(line.qty)) : 0), reason: '' };
}
/** Только явно изменённая цена за единицу становится источником пересчёта. */
export function changeLine(draft, key, value, unitEdited = false) {
  const next = { ...draft, [key]: value };
  if (key === 'unitPrice' || (key === 'qty' && unitEdited)) next.lineAmount = String(roundMoney(Number(next.unitPrice) * Number(next.qty)));
  else if (key === 'lineAmount' || key === 'qty') next.unitPrice = String(Number(next.qty) > 0 ? roundMoney(Number(next.lineAmount) / Number(next.qty)) : 0);
  return next;
}
export function lineBody(invoice, draft) {
  const qty = Number(draft.qty), sum = Number(draft.lineAmount);
  if (!String(draft.qty).trim() || !Number.isFinite(qty) || qty <= 0) throw new Error('Количество должно быть больше нуля');
  if (!String(draft.lineAmount).trim() || !Number.isFinite(sum) || sum < 0) throw new Error('Сумма строки не может быть отрицательной или пустой');
  if (!String(draft.unitPrice).trim() || !Number.isFinite(Number(draft.unitPrice)) || Number(draft.unitPrice) < 0) throw new Error('Цена не может быть отрицательной или пустой');
  const reason = String(draft.reason || '').trim();
  // У legacy-документа отсутствующая version означает 0: SupplyInvoiceService.patchLine сравнивает fresh.version ?? 0.
  const version = Number(invoice.version ?? 0);
  if (!Number.isInteger(version) || version < 0) throw new Error('Обновите счёт перед сохранением — версия неизвестна');
  return { qty, lineAmount: sum, version, ...(reason ? { reason } : {}) };
}
export function addBody(invoice, ids, reason = '') {
  if (!ids.length) throw new Error('Отметьте хотя бы одну заявку');
  if (new Set(ids).size > 200) throw new Error('За один раз можно добавить не более 200 заявок');
  reason = String(reason).trim();
  return { requestIds: [...new Set(ids)], ...(reason ? { reason } : {}) };
}
export function metaBody(invoice, draft, rights) {
  const p = permissions(invoice, rights);
  if (!p.meta) throw new Error('Этот счёт доступен только для просмотра');
  const body = { no: String(draft.no || '').trim(), date: draft.date || '', fileIds: draft.fileIds || [], contractId: draft.contractId || '' };
  if (draft.note !== undefined) body.note = String(draft.note ?? '').trim();
  if (draft.deliveryDate !== undefined) body.deliveryDate = draft.deliveryDate || '';
  if (p.payer && draft.payerCompanyId !== undefined) {
    body.payerCompanyId = draft.payerCompanyId;
  }
  const duplicateReason = String(draft.duplicateReason || '').trim();
  if (duplicateReason && !p.boundary) body.duplicateReason = duplicateReason;
  if (p.finance) Object.assign(body, financialMetaBody(draft, invoice));
  return body;
}
export function assertOperation(invoice, rights, operation, lineId) {
  const p = permissions(invoice, rights);
  const allowed = { meta: p.meta, line: p.editLine, add: p.add, remove: p.removeLine, issue: p.issue, pay: p.pay, payment: p.pay, undated: p.confirmUndated, revokeUndated: p.revokeUndated, receive: p.receive };
  if (!allowed[operation]) throw new Error(p.reason || 'Недостаточно прав для этого действия');
  if ((operation === 'issue' || operation === 'pay') && !invoice.payerCompanyId) {
    throw new Error('Укажите «Нашу компанию» — кто платит (иначе расход не попадёт в «Деньги»)');
  }
  if (['line', 'remove'].includes(operation)) {
    const line = (invoice.requests || []).find((r) => r.id === lineId);
    // принятую позицию можно только переоценить (line), но не убрать
    const closed = operation === 'line' ? ['cancelled'] : ['received', 'cancelled'];
    if (!line || line.deletedAt || closed.includes(line.status)) throw new Error('Эту позицию нельзя изменить или убрать из счёта');
  }
  return p;
}


/** C158: намерение открыть общую форму живёт только до открытия карточки. */
const invoiceOperations = new Map();
export function requestInvoiceOperation(id, operation = 'payment') { invoiceOperations.set(String(id), operation); }
export function takeInvoiceOperation(id) { const op = invoiceOperations.get(String(id)); invoiceOperations.delete(String(id)); return op; }
export const invoiceCurrency = (invoice) => invoice.currency === 'UE' ? (invoice.currencyName || 'у.е.') : (invoice.currency || 'RUB');
export const foreignInvoice = (invoice) => !!invoice.currency && invoice.currency !== 'RUB';
export function sourceMoney(value, invoice) { return value == null ? 'Не указано' : `${Number(value).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${invoiceCurrency(invoice)}`; }
export function paymentStateLabel(invoice) { if (needsPaymentDate(invoice)) return 'Оплата подтверждена — заполнить дату'; if (invoice.reconciliationRequired || invoice.paymentState === 'reconciliation') return 'Требует сверки'; return ({ unpaid: 'Не оплачен', partial: 'Частично оплачен', paid: 'Оплачен' })[invoice.paymentState] || (invoice.status === 'paid' ? 'Оплачен' : 'Не оплачен'); }
export function businessToday() { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const pick = k => parts.find(p => p.type === k).value; return `${pick('year')}-${pick('month')}-${pick('day')}`; }
const numeric = (v, label, { positive = false, precision = 2 } = {}) => {
  const raw = String(v ?? '').trim().replace(',', '.'); const n = Number(raw);
  if (!raw || !Number.isFinite(n) || (positive ? n <= 0 : n < 0) || !/^\d+(?:\.\d+)?$/.test(raw) || (raw.split('.')[1]?.length || 0) > precision) throw new Error(`${label}: введите ${positive ? 'положительное' : 'неотрицательное'} число, до ${precision} знаков после запятой`);
  return n;
};
export function financialMetaBody(draft, previous) {
  if (draft.currency === undefined) return {};
  const currency = draft.currency || 'RUB';
  if (!['RUB', 'USD', 'EUR', 'CNY', 'UE'].includes(currency)) throw new Error('Выберите валюту счёта');
  const body = { currency };
  const vatMode = draft.vatMode || '';
  if (['included', 'excluded'].includes(vatMode) && (draft.vatRate === '' || draft.vatRate == null)) throw Object.assign(new Error('Укажите ставку НДС; 0% и «Без НДС» — разные варианты'), { field: 'vatRate' });
  if (vatMode) body.vatMode = vatMode;
  else if (previous?.vatMode) body.vatMode = null;
  if (currency === 'UE' && !String(draft.currencyName || '').trim()) throw new Error('Укажите, что означает условная единица по договору');
  body.currencyName = currency === 'UE' ? String(draft.currencyName).trim() : '';
  if (currency !== 'RUB') {
    body.exchangeRate = String(draft.exchangeRate ?? '').trim() ? numeric(draft.exchangeRate, 'Курс', { positive: true, precision: 8 }) : null;
    body.exchangeRateDate = body.exchangeRate ? draft.exchangeRateDate || '' : '';
    body.exchangeRateSource = body.exchangeRate ? String(draft.exchangeRateSource || '').trim() : '';
    if (body.exchangeRate && (!body.exchangeRateDate || !body.exchangeRateSource)) throw new Error('Для курса укажите дату и основание');
    body.confirmedAmountRub = String(draft.confirmedAmountRub ?? '').trim() ? numeric(draft.confirmedAmountRub, 'Подтверждённая сумма в рублях') : null;
    body.conversionNote = String(draft.conversionNote || '').trim();
    if (body.confirmedAmountRub != null && !body.conversionNote && !(draft.fileIds || []).length) throw new Error('Укажите основание подтверждённой суммы в рублях или приложите документ');
  }
  if (vatMode || previous?.vatMode || String(draft.vatRate ?? '').trim()) body.vatRate = ['none', 'mixed'].includes(vatMode) || draft.vatRate === '' || draft.vatRate == null ? null : Number(draft.vatRate);
  if (!vatMode && String(draft.vatRate ?? '').trim()) throw Object.assign(new Error('Укажите, как НДС записан в первичке'), { field: 'vatMode' });
  if (String(draft.declaredVatAmount ?? '').trim()) body.declaredVatAmount = numeric(draft.declaredVatAmount, 'НДС по документу');
  else if (previous?.declaredVatAmount != null) body.declaredVatAmount = null;
  if (previous) {
    const same = (key, value) => {
      const old = previous[key];
      if (key === 'currency') return value === (old || 'RUB');
      if (typeof value === 'number') return old != null && value === Number(old);
      if (value == null) return old == null || old === '';
      if (key === 'exchangeRateDate') return value === String(old || '').slice(0, 10);
      return value === String(old ?? '');
    };
    for (const [key, value] of Object.entries(body)) if (same(key, value)) delete body[key];
  }
  return body;
}
export function paymentBody(invoice, draft, clientUid) {
  const date = String(draft.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date || date > businessToday()) throw new Error('Укажите фактическую дату оплаты, не позже сегодняшней');
  if (!draft.payerCompanyId) throw new Error('Выберите нашу компанию — плательщика');
  const amount = numeric(draft.amount, 'Фактически уплачено, ₽', { positive: true });
  if (needsPaymentDate(invoice) && (amount !== Number(invoice.undatedConfirmedAmountRub) || String(draft.payerCompanyId) !== String(invoice.undatedPaymentEvidence?.payerCompanyId || invoice.payerCompanyId))) throw new Error('Сумма и плательщик должны совпадать с подтверждением оплаты');
  const body = { clientUid, date, amount, payerCompanyId: draft.payerCompanyId, version: Number(invoice.version ?? 0), fileIds: draft.fileIds || [], note: String(draft.note || '').trim() };
  if (foreignInvoice(invoice)) body.sourceAmount = numeric(draft.sourceAmount, 'Погашено в валюте счёта', { positive: true });
  else if (invoice.balanceDue != null && amount > Number(invoice.balanceDue)) throw new Error('Оплата превышает непогашенный остаток');
  if (foreignInvoice(invoice) && invoice.sourceBalance != null && body.sourceAmount > Number(invoice.sourceBalance)) throw new Error('Погашение превышает остаток в валюте счёта');
  return body;
}

/** Одна смысловая плашка на причину; реальная сверка имеет предупредительный тон. */
export function invoiceWarnings(invoice, rights) {
  if (invoice._refreshError) return [];
  const reconciliation = invoice.reconciliationRequired || invoice.paymentState === 'reconciliation';
  const reason = permissions(invoice, rights).reason;
  const warnings = new Map();
  const add = (text, tone) => {
    const title = String(text || '').replace(/\s+/g, ' ').trim(); if (!title) return;
    const key = title.toLocaleLowerCase('ru');
    if (warnings.has(key)) { if (tone === 'warn') warnings.get(key).tone = 'warn'; }
    else warnings.set(key, { title, tone });
  };
  add(reason, reconciliation || needsPaymentDate(invoice) ? 'warn' : 'neutral');
  for (const warning of invoice.warnings || []) add(typeof warning === 'string' ? warning : warning.message || warning.title || 'Проверьте финансовые данные', 'warn');
  return [...warnings.values()];
}
