/** Чистые правила workspace: без DOM, сессии и транспорта. Сервер проверяет их повторно. */
export const lineAmount = (line) => Number(line.lineAmount ?? line.priceHint ?? 0);
export const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
export const pendingLines = (invoice) => (invoice.requests || []).filter((r) => !r.deletedAt && !['received', 'cancelled'].includes(r.status));
export function permissions(invoice, rights) {
  const whole = !invoice.partial;
  const live = invoice.status !== 'cancelled';
  const boundary = !!(invoice.receiptBoundaryAt || invoice.lockReason || (invoice.requests || []).some((r) => r.status === 'received'));
  const meta = !!rights.canEdit && whole && live;
  const finance = meta && !!rights.canMoney && !boundary;
  const isAdmin = !!(rights.isAdmin || rights.role === 'admin' || rights.user?.isOwner);
  const paid = invoice.status === 'paid';
  // Позиции (добавить / править / убрать) — только админ и только до первой приёмки; оплата счёта не блокирует убрать.
  // Позиции до приёмки — менеджер и админ, как на сервере (решение Б 2026-11-06); из оплаченного убирает только админ.
  const linesAdmin = meta && !boundary;
  // «Наша компания» неоплаченного счёта — и после приёмки: без неё счёт не оплатить
  const payer = meta && !!rights.canMoney && (!boundary || !paid);
  const reason = !whole ? 'Часть строк скрыта другим складом. Доступен только просмотр видимых позиций.'
    : !live ? 'Счёт отменён. Доступен только просмотр.'
      : boundary ? (isAdmin ? 'По счёту уже есть приёмка. Вы можете исправить цену и сумму позиции; количество принятой позиции меняется отменой приёмки.'
        : 'По счёту уже есть приёмка. Цены исправляет администратор; можно менять номер, дату, файлы и договор.')
        : paid ? 'До первой приёмки позиции можно править; убрать позицию из оплаченного счёта может администратор. Исходный платёж не меняется.' : '';
  // Цену позиции администратор исправляет на любой стадии (решение 2026-11-06); добавить и убрать — только до приёмки.
  return { whole, live, boundary, meta, finance, payer, paid, isAdmin, reason,
    add: linesAdmin && !!rights.canMoney, editLine: meta && !!rights.canMoney && (isAdmin || !boundary), removeLine: linesAdmin && (isAdmin || !paid),
    // ЗЯ-1c: только администратор; сервер повторно проверяет и просит причину.
    unpay: isAdmin && !!rights.canMoney && whole && live && paid && !boundary,
    rollback: isAdmin && !!rights.canMoney && whole && live,
    issue: finance && invoice.status === 'draft',
    pay: meta && !!rights.canMoney && invoice.status === 'issued',
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
  if (p.payer && draft.payerCompanyId !== undefined) {
    body.payerCompanyId = draft.payerCompanyId;
  }
  const duplicateReason = String(draft.duplicateReason || '').trim();
  if (duplicateReason && !p.boundary) body.duplicateReason = duplicateReason;
  return body;
}
export function assertOperation(invoice, rights, operation, lineId) {
  const p = permissions(invoice, rights);
  const allowed = { meta: p.meta, line: p.editLine, add: p.add, remove: p.removeLine, issue: p.issue, pay: p.pay, receive: p.receive };
  if (!allowed[operation]) throw new Error(p.reason || 'Недостаточно прав для этого действия');
  if (['line', 'remove'].includes(operation)) {
    const line = (invoice.requests || []).find((r) => r.id === lineId);
    // принятую позицию можно только переоценить (line), но не убрать
    const closed = operation === 'line' ? ['cancelled'] : ['received', 'cancelled'];
    if (!line || line.deletedAt || closed.includes(line.status)) throw new Error('Эту позицию нельзя изменить или убрать из счёта');
  }
  return p;
}
