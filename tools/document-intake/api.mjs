import { isDeepStrictEqual } from 'node:util';
import { IntakeError, MAX_BYTES, sha256 } from './store.mjs';
import { cents, question, supplierTotals } from './proposal.mjs';

const objectId = (value) => typeof value === 'string' && /^[\da-f]{24}$/i.test(value);
const idOf = (doc) => doc?.id ?? doc?._id;
const dayOf = (date) => typeof date === 'string' ? date.slice(0, 10) : '';
const equalMoney = (a, b) => typeof a === 'number' && typeof b === 'number' && cents(a) === cents(b);
const nameKey = (name) => typeof name === 'string' ? name.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, ' ') : '';
const RESOLVE = 'Откройте существующую карточку и сравните номер, дату, стороны, строки и оригинал.';

function immutableRequest(saved, expected) {
  if (saved && !isDeepStrictEqual(saved, expected)) {
    throw new IntakeError('JOURNAL', 'Подготовленный запрос изменился после начала записи.', 'Сохраните журнал и проверьте уже учтённые данные в DataCore.');
  }
  return saved ?? expected;
}

export function apiAddress(value) {
  let url;
  try { url = new URL(value); } catch { /* адрес не указан */ }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || (url.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) {
    throw new IntakeError('API_UNAVAILABLE', 'Укажите адрес DataCore. Для другого компьютера нужен HTTPS.');
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = pathname.endsWith('/api') ? pathname : `${pathname}/api`;
  return url.href;
}

export function connectApi({ apiBase, token, signal }) {
  const base = apiAddress(apiBase);
  const validToken = (value) => typeof value === 'string' && value.trim() && !/\s/.test(value) && value.length <= 4096;
  const authRequired = () => new IntakeError('AUTH', 'Войдите в DataCore для разбора документов.');
  if (typeof token !== 'function' && !validToken(token)) throw authRequired();
  const params = (query) => query ? `?${new URLSearchParams(query)}` : '';
  function failed(status) {
    if (status === 401 || status === 403) throw new IntakeError('AUTH', 'DataCore просит войти снова или открыть нужные права.', 'Войдите в DataCore с доступом к документам, контрагентам и суммам, затем возобновите разбор.');
    if (status === 409) throw question('DataCore обнаружил существующий или изменённый источник.', RESOLVE);
    if (status === 400 || status === 413 || status === 422) throw question('DataCore отклонил реквизиты или формат файла.', 'Сверьте обязательные поля в карточке и проверьте тип оригинала.');
    throw new IntakeError('API_UNAVAILABLE', 'DataCore недоступен или не смог подтвердить операцию.', 'Проверьте соединение с тем же сайтом и возобновите разбор.');
  }
  async function response(url, { method = 'GET', body, absent = false } = {}) {
    signal?.throwIfAborted();
    let access;
    try { access = typeof token === 'function' ? await token() : token; }
    catch { signal?.throwIfAborted(); throw authRequired(); }
    signal?.throwIfAborted();
    if (!validToken(access)) throw authRequired();
    const headers = { Authorization: `Bearer ${access}` };
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    let r;
    try {
      r = await fetch(url, {
        method, body, headers, redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      failed();
    }
    if (absent && r.status === 404) return null;
    if (!r.ok) {
      await r.body?.cancel().catch(() => {});
      failed(r.status);
    }
    return r;
  }
  async function json(endpoint, options) {
    const r = await response(`${base}${endpoint}`, options);
    if (!r) return null;
    try { return await r.json(); }
    catch (e) { if (signal?.aborted) throw e; failed(); }
  }
  return {
    get: (endpoint, query, absent) => json(`${endpoint}${params(query)}`, { absent }),
    post: (endpoint, body, query) => json(`${endpoint}${params(query)}`, { method: 'POST', body }),
    async original(url, expectedLength) {
      // API может быть опубликован под /db. Хранимый URL начинается в корне приложения.
      if (typeof url !== 'string' || !/^\/uploads\/[A-Za-z0-9/_%.-]+$/.test(url)
        || url.includes('//') || /%(?:2e|2f|5c)/i.test(url) || url.split('/').includes('..')) {
        throw question('Ссылка на оригинал не принадлежит этому контуру.', RESOLVE);
      }
      const r = await response(`${base.slice(0, -4)}${url}`);
      const reader = r.body.getReader();
      const chunks = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > expectedLength || bytes > MAX_BYTES) throw question('Размер загруженного оригинала отличается от исходного.', RESOLVE);
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      return Buffer.concat(chunks, bytes);
    },
  };
}

async function all(api, endpoint, query = {}) {
  const result = [];
  for (let page = 1; page <= 100; page++) {
    const payload = await api.get(endpoint, { ...query, page, limit: 100 });
    if (!Array.isArray(payload?.items) || !Number.isInteger(payload.total)) {
      throw new IntakeError('API_UNAVAILABLE', 'DataCore не вернул проверяемый список записей.', 'Возобновите разбор после восстановления API.');
    }
    result.push(...payload.items);
    if (result.length >= payload.total) return result;
    if (!payload.items.length) break;
  }
  throw question('Список совпадений слишком большой или изменяется во время чтения.', 'Найдите карточку вручную по номеру, дате и покупателю.');
}

export async function authorize(api) {
  const actor = await api.get('/auth/me');
  if (!actor?.id || !actor.canMoney || ![actor.baseRole, actor.role].some((role) => ['admin', 'manager'].includes(role))) {
    throw new IntakeError('AUTH', 'Для импорта нужен доступ менеджера к документам и суммам.', 'Войдите под рабочей учётной записью с этими правами.');
  }
  return actor;
}

async function lookupParty(api, party) {
  const entries = await all(api, '/organizations', { search: party.inn });
  const matches = entries.filter((row) => row.inn === party.inn && !row.deletedAt);
  return matches.length === 1 && objectId(idOf(matches[0])) ? matches[0] : null;
}

function supplierRole(party) {
  return [].concat(party?.type ?? []).includes('supplier');
}

async function resolveParty(api, party, own, supplier = false) {
  const match = await lookupParty(api, party);
  if (!match || Boolean(match.isOurCompany) !== own || (supplier && !supplierRole(match))) {
    throw question(own ? 'Наша фирма по ИНН не найдена однозначно.' : supplier ? 'Поставщик по ИНН не найден однозначно.' : 'Заказчик по ИНН не найден однозначно.',
      'Откройте «Контрагенты», сверьте ИНН и признак нашей компании. Проверьте документ вручную.');
  }
  return idOf(match);
}

export async function decideInvoice(api, proposal) {
  const seller = await lookupParty(api, proposal.seller);
  const buyer = await lookupParty(api, proposal.buyer);
  if (seller && buyer && seller.isOurCompany && !buyer.isOurCompany) return { kind: 'customer_invoice' };
  if (seller && buyer && !seller.isOurCompany && buyer.isOurCompany && supplierRole(seller)) {
    return { kind: 'supplier_invoice', parties: { supplierId: idOf(seller), payerCompanyId: idOf(buyer) } };
  }
  throw question('Поставщик и плательщик счёта не подтверждены по ИНН.',
    'В «Контрагентах» проверьте ИНН, признак нашей компании и роль поставщика. После сверки откройте счёт в «Снабжении».');
}

const pathFor = (p) => p.kind === 'offer' ? '/offers' : '/salesorders';
const refFor = (doc, kind) => doc?.legal?.documents?.find((file) => file?.kind === kind);

async function candidates(api, doc) {
  const p = doc.proposal;
  const offer = p.kind === 'offer';
  const endpoint = pathFor(p);
  // Список КП ищет только внутренний номер/клиента/название. Печатные номера сверяем в списке сами.
  const query = offer ? {} : { search: p.number, filter: 'all' };
  const isCandidate = (row) => {
    if (!offer && row.intakeUid === doc.uid) return true;
    const date = dayOf(offer ? row.date : row.contractDate);
    const number = offer ? row.sourceNumber ?? row.number : row.orderNo;
    const sameParty = row.counterpartyId === doc.parties.counterpartyId || nameKey(row.customer) === nameKey(p.buyer.name);
    const sameNumber = p.number !== null && nameKey(number) === nameKey(p.number);
    return sameNumber && (row.companyId === doc.parties.companyId || sameParty)
      || date === p.date && sameParty && (row.companyId === doc.parties.companyId || !row.companyId)
        && (offer || !number);
  };
  const deleted = (await all(api, endpoint, { ...query, deleted: '1' })).filter(isCandidate);
  if (deleted.length) throw question('Похожий документ найден в корзине.', 'Сверьте документ в корзине. При необходимости восстановите карточку вручную.');
  const active = (await all(api, endpoint, query)).filter(isCandidate);
  if (active.length > 1) throw question('Найдено несколько похожих документов.', RESOLVE);
  if (!active.length) return null;
  if (!objectId(idOf(active[0]))) throw question('Идентификатор найденного документа не подтверждён.', RESOLVE);
  const detail = await api.get(`${endpoint}/${idOf(active[0])}`, undefined, true);
  if (!detail || refFor(detail, p.kind)?.sourceSha256 !== doc.hash) {
    throw question('Найден документ с похожими реквизитами и другим или неизвестным оригиналом.', RESOLVE);
  }
  return detail;
}

function makeLegal(doc) {
  const p = doc.proposal;
  const issues = [
    ['signature', 'Подпись', 'Подпись требует отдельной проверки.'],
    ['paymentVerification', 'Платёж', 'В документе нет подтверждения платежа.'],
  ];
  if (!p.vat || (p.vat.mode !== 'none' && (p.vat.rate === null || p.vat.amount === null))) {
    issues.push(['other', 'НДС', 'Проверьте недостающие сведения о НДС.']);
  }
  if (p.kind === 'contract') {
    issues.push(['productionAssignment', 'Производство', 'Производственный заказ назначается отдельно.']);
    issues.push(['paymentPlan', 'График оплаты', 'График оплаты требует отдельной проверки.']);
  }
  const tax = { ...(p.vat?.rate != null ? { vatRate: p.vat.rate } : {}), ...(p.vat?.amount != null ? { vatAmount: p.vat.amount } : {}) };
  return {
    state: 'draft', origin: { kind: 'source_import' }, currency: p.currency, gross: p.gross, sourceDate: p.date,
    ...(p.number !== null ? { sourceNumber: p.number } : {}),
    ...tax, ...(p.vat ? { vatMode: p.vat.mode } : {}),
    companySnapshot: p.seller, counterpartySnapshot: p.buyer,
    signature: { state: 'unknown' }, paymentVerification: 'unknown', paymentPlan: [],
    documents: [{
      uid: doc.uid, kind: p.kind, ...(p.number !== null ? { number: p.number } : {}), date: p.date, revision: p.revision ?? '1',
      fileId: doc.fileId, sourceSha256: doc.hash, gross: p.gross, currency: p.currency, ...tax,
    }],
    issues: issues.map(([field, label, reason]) => ({ uid: `${doc.uid}:${field}`, field, label, reason, state: 'unknown', documentUid: doc.uid })),
  };
}

const sourceFor = (doc, row, i) => ({
  documentUid: doc.uid, rowKey: String(i + 1), title: row.title, qty: row.qty, unit: row.unit, unitPrice: row.unitPrice, lineAmount: row.amount,
});

function makePayload(doc) {
  const p = doc.proposal;
  const common = { ...doc.parties, customer: p.buyer.name, intakeUid: doc.uid, initialLegal: makeLegal(doc) };
  if (p.kind === 'contract') return { ...common, orderNo: p.number, contractDate: p.date, productionAssignment: 'unassigned' };
  return {
    ...common, date: p.date, ...(p.number === null ? {} : { sourceNumber: p.number }),
    ...(p.vat?.mode === 'none' ? { vatMode: 'without' } : p.vat ? { vatMode: 'with' } : {}),
    ...(p.vat?.rate != null && p.vat.rate <= 30 && p.vat.mode !== 'none' ? { vatRate: p.vat.rate } : {}),
    items: p.lines.map((row, i) => {
      const sourceLine = sourceFor(doc, row, i);
      return { productName: row.title, quantity: row.qty, unit: row.unit, unitPrice: row.unitPrice,
        sourceLine, sourceRowKey: sourceLine.rowKey, scopeState: 'included' };
    }),
  };
}

function validSource(actual, doc, row, i) {
  const wanted = sourceFor(doc, row, i);
  return actual && ['documentUid', 'rowKey', 'title', 'qty', 'unit', 'unitPrice', 'lineAmount'].every((f) => actual[f] === wanted[f]);
}

function matchesRow(actual, doc, row, i) {
  if (!validSource(actual?.sourceLine, doc, row, i)) return false;
  if (doc.proposal.kind === 'offer') {
    return actual.sourceRowKey === String(i + 1) && actual.productName === row.title
      && actual.quantity === row.qty && actual.unit === row.unit && equalMoney(actual.unitPrice, row.unitPrice) && equalMoney(actual.total, row.amount);
  }
  return actual.title === row.title && actual.qty === row.qty && actual.unit === row.unit
    && equalMoney(actual.unitPrice, row.unitPrice) && equalMoney(actual.amount, row.amount)
    && actual.matchingMode === 'manual' && !actual.cancelledAt && !actual.deletedAt;
}

function assertHeader(entity, doc) {
  const p = doc.proposal;
  const offer = p.kind === 'offer';
  const legal = entity?.legal;
  const ref = refFor(entity, p.kind);
  if (!objectId(idOf(entity)) || entity.deletedAt || entity.companyId !== doc.parties.companyId
    || entity.counterpartyId !== doc.parties.counterpartyId || dayOf(offer ? entity.date : entity.contractDate) !== p.date
    || (offer ? entity.sourceNumber ?? null : entity.orderNo) !== p.number
    || legal?.origin?.kind !== 'source_import' || legal?.sourceDate !== p.date || (legal?.sourceNumber ?? null) !== p.number
    || legal?.companySnapshot?.inn !== p.seller.inn || legal?.counterpartySnapshot?.inn !== p.buyer.inn
    || legal?.currency !== p.currency || !equalMoney(legal?.gross, p.gross) || (offer && !equalMoney(entity.total, p.gross))
    || (p.vat && (legal.vatMode !== p.vat.mode || (p.vat.rate !== null && legal.vatRate !== p.vat.rate)
      || (p.vat.amount !== null && !equalMoney(legal.vatAmount, p.vat.amount))))
    || ref?.uid !== doc.uid || ref.fileId !== doc.fileId || ref.sourceSha256 !== doc.hash
    || ref.revision !== (p.revision ?? '1') || ref.date !== p.date || (ref.number ?? null) !== p.number
    || ref.currency !== p.currency || !equalMoney(ref.gross, p.gross)) {
    throw question('При повторном чтении реквизиты или ссылка на оригинал не совпали.', RESOLVE);
  }
}

function assertReceipt(receipt, doc) {
  if (receipt?.uid !== doc.uid || receipt.sha256 !== doc.hash || !objectId(receipt.fileId)
    || !receipt.storageUrl || (doc.fileId && doc.fileId !== receipt.fileId)) {
    throw question('Квитанция загрузки не совпадает с исходным файлом.', RESOLVE);
  }
}

async function originalProof(api, doc, bytes) {
  const receipt = await api.get(`/photos/intake/${doc.uid}`, undefined, true);
  if (!receipt) throw new IntakeError('API_UNAVAILABLE', 'DataCore не подтвердил наличие оригинала.', 'Проверьте доступ к файлам DataCore и возобновите разбор.');
  assertReceipt(receipt, doc);
  const meta = await api.get(`/photos/${doc.fileId}`, undefined, true);
  if (idOf(meta) !== doc.fileId || meta?.storageUrl !== receipt.storageUrl || meta?.sizeBytes !== bytes.length || meta?.mimeType !== 'application/pdf') {
    throw question('Карточка файла не подтверждает загруженный оригинал.', RESOLVE);
  }
  const copied = await api.original(receipt.storageUrl, bytes.length);
  if (copied.length !== bytes.length || sha256(copied) !== doc.hash) throw question('Содержимое оригинала на сайте отличается от исходного.', RESOLVE);
  return receipt;
}

async function recoverFile(api, doc, bytes, name, save, existing) {
  const endpoint = `/photos/intake/${doc.uid}`;
  let receipt = await api.get(endpoint, undefined, true);
  if (!receipt && (existing || doc.fileId)) throw question('Документ уже есть, но его оригинал не подтверждён квитанцией разбора.', RESOLVE);
  if (receipt && !doc.uploadStarted && !existing) throw question('Загруженный файл уже есть без доказанной связи с документом.', RESOLVE);
  if (!receipt) {
    doc.uploadStarted = true;
    await save();
    const form = new FormData();
    form.set('file', new Blob([bytes], { type: 'application/pdf' }), name);
    await api.post(endpoint, form, { sha256: doc.hash });
    receipt = await api.get(endpoint, undefined, true);
    if (!receipt) throw new IntakeError('API_UNAVAILABLE', 'Ожидается квитанция загрузки оригинала.', 'Возобновите разбор в том же контуре.');
  }
  assertReceipt(receipt, doc);
  if (existing && (doc.proposal.kind === 'supplier_invoice'
    ? !existing.fileIds?.includes(receipt.fileId)
    : refFor(existing, doc.proposal.kind)?.fileId !== receipt.fileId)) {
    throw question('Найденная карточка ссылается на другой файл.', RESOLVE);
  }
  doc.fileId = receipt.fileId;
  await save();
  if (!existing) await originalProof(api, doc, bytes);
}

async function saveIncomeLines(api, doc, entity, save) {
  if (!Array.isArray(entity.lines)) throw question('DataCore не показал строки договора.', RESOLVE);
  const p = doc.proposal;
  const known = new Set();
  for (const line of entity.lines) {
    const i = Number(line.sourceLine?.rowKey) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= p.lines.length || known.has(i) || !matchesRow(line, doc, p.lines[i], i)) {
      throw question('В договоре есть другая или изменённая строка.', RESOLVE);
    }
    known.add(i);
  }
  doc.incomes ??= {};
  for (const [index, row] of p.lines.entries()) {
    if (known.has(index)) continue;
    const sourceLine = sourceFor(doc, row, index);
    const key = sourceLine.rowKey;
    if (doc.incomes[key]?.confirmedId) throw question('Ранее подтверждённая строка отсутствует в договоре.', RESOLVE);
    const payload = {
      orderId: doc.entityId, clientUid: `${doc.uid}:${key}`, matchingMode: 'manual', sourceLine, lineNo: index + 1,
      title: row.title, qty: row.qty, unit: row.unit, unitPrice: row.unitPrice, amountManual: row.amount,
    };
    const request = immutableRequest(doc.incomes[key]?.payload, payload);
    doc.incomes[key] ??= { payload: request };
    await save();
    const saved = await api.post('/incomes', doc.incomes[key].payload);
    if (!objectId(idOf(saved))) throw new IntakeError('API_UNAVAILABLE', 'DataCore не подтвердил добавление строки.');
    doc.incomes[key].confirmedId = idOf(saved);
    await save();
  }
}

async function finalProof(api, doc, bytes, final) {
  assertHeader(final, doc);
  const p = doc.proposal;
  const offer = p.kind === 'offer';
  const lines = offer ? final.items : final.lines;
  const indexed = Array.isArray(lines) ? new Map(lines.map((row) => [row.sourceLine?.rowKey, row])) : new Map();
  if (idOf(final) !== doc.entityId || indexed.size !== p.lines.length || lines?.length !== p.lines.length
    || p.lines.some((row, i) => !matchesRow(indexed.get(String(i + 1)), doc, row, i))) {
    throw question('При повторном чтении не подтвердилось число строк, состав или суммы.', RESOLVE);
  }
  if (!doc.complete && !doc.adopted && (offer
    ? final.status !== 'draft' || Boolean(final.orderId)
    : Boolean(final.productionNo) || final.lines.some((line) => line.paidDate || line.payments?.length || (line.paidAmount ?? 0) !== 0))) {
    throw question('Новый документ связан с производством, оплатой или изменил статус.', RESOLVE);
  }
  await originalProof(api, doc, bytes);
}

const invoiceEndpoint = '/supply/invoices';
const invoiceIntake = `${invoiceEndpoint}/intake`;
const INVOICE_RESOLVE = 'Откройте «Снабжение» → «Счета», сравните поставщика, плательщика, полный номер, дату, суммы и оригинал.';

function makeInvoicePayload(doc) {
  const p = doc.proposal;
  return {
    uid: doc.uid, sourceSha256: doc.hash, fileId: doc.fileId, ...doc.parties, no: p.number, date: p.date, currency: 'RUB',
    gross: p.gross, vatMode: p.vat.mode,
    ...(p.vat.mode !== 'none' && p.vat.rate !== null ? { vatRate: p.vat.rate } : {}),
    ...(p.vat.amount !== null ? { vatAmount: p.vat.amount } : {}),
    lines: p.lines.map((row, i) => ({ rowKey: String(i + 1), title: row.title, qty: row.qty, unit: row.unit, unitPrice: row.unitPrice, amount: row.amount })),
  };
}

function assertInvoiceReceipt(receipt, doc) {
  if (receipt?.uid !== doc.uid || receipt.sourceSha256 !== doc.hash || !objectId(receipt.invoiceId)
    || !/^[a-f\d]{64}$/.test(receipt.payloadHash ?? '') || !Array.isArray(receipt.requestIds)
    || receipt.requestIds.length !== doc.proposal.lines.length || !receipt.requestIds.every(objectId)
    || new Set(receipt.requestIds).size !== receipt.requestIds.length || (doc.entityId && doc.entityId !== receipt.invoiceId)
    || (doc.invoiceReceipt && (doc.invoiceReceipt.payloadHash !== receipt.payloadHash
      || doc.invoiceReceipt.requestIds.some((id, index) => id !== receipt.requestIds[index])))) {
    throw question('Квитанция счёта не подтверждает его источник или строки.', INVOICE_RESOLVE);
  }
}

async function invoiceDetail(api, receipt) {
  const entity = await api.get(`${invoiceEndpoint}/${receipt.invoiceId}`, undefined, true);
  if (!entity || idOf(entity) !== receipt.invoiceId || entity.partial || entity.deletedAt || entity.status === 'cancelled') {
    throw question('Счёт больше недоступен целиком, отменён или удалён.', INVOICE_RESOLVE);
  }
  return entity;
}

async function invoiceProof(api, doc, bytes, receipt, entity) {
  const p = doc.proposal;
  const { tax } = supplierTotals(p.lines, p.vat);
  if (entity.supplierId !== doc.parties.supplierId || entity.payerCompanyId !== doc.parties.payerCompanyId
    || entity.no !== p.number || dayOf(entity.date) !== p.date || entity.currency !== p.currency
    || !equalMoney(entity.amount, p.gross) || !equalMoney(entity.sourceAmount, p.gross)
    || entity.vatMode !== p.vat.mode || (p.vat.mode !== 'none' && entity.vatRate !== p.vat.rate)
    || !equalMoney(entity.calculatedVatAmount, tax / 100)
    || (p.vat.amount !== null && !equalMoney(entity.declaredVatAmount, p.vat.amount))
    || !entity.fileIds?.includes(doc.fileId) || !entity.files?.some((file) => file.id === doc.fileId)) {
    throw question('Реквизиты, налог или оригинал не совпали при повторном чтении счёта.', INVOICE_RESOLVE);
  }
  const requests = Array.isArray(entity.requests) ? new Map(entity.requests.map((row) => [idOf(row), row])) : new Map();
  const mismatch = p.lines.some((row, index) => {
    const saved = requests.get(receipt.requestIds[index]);
    return saved?.title !== row.title || saved.qty !== row.qty || saved.unit !== row.unit || saved.deletedAt || saved.status === 'cancelled'
      || !equalMoney(saved.sourceUnitPrice, row.unitPrice) || !equalMoney(saved.sourceLineAmount, row.amount);
  });
  if (requests.size !== p.lines.length || entity.requests?.length !== p.lines.length || mismatch) {
    throw question('При повторном чтении не подтвердились строки счёта или исходные цены.', INVOICE_RESOLVE);
  }
  if (!doc.complete && !doc.adopted && (entity.status !== 'draft' || entity.paidAt || (entity.paidAmount ?? 0) !== 0
    || entity.paymentState !== 'unpaid' || entity.requests.some((row) => row.status !== 'ordered' || row.paid || (row.receivedQty ?? 0) !== 0))) {
    throw question('У нового счёта появился платёж, приёмка или другой статус.', INVOICE_RESOLVE);
  }
  await originalProof(api, doc, bytes);
}

async function executeInvoice({ api, doc, bytes, name, save }) {
  const p = doc.proposal;
  if (!doc.parties) {
    doc.parties = { supplierId: await resolveParty(api, p.seller, false, true), payerCompanyId: await resolveParty(api, p.buyer, true) };
    await save();
  }
  const lookup = `${invoiceIntake}/${doc.uid}`;
  let receipt = await api.get(lookup, undefined, true);
  let entity;
  if (receipt) {
    assertInvoiceReceipt(receipt, doc);
    entity = await invoiceDetail(api, receipt);
    if (!doc.complete) {
      const wasStartedHere = Boolean(doc.headerPayload);
      await recoverFile(api, doc, bytes, name, save, entity);
      doc.adopted = !wasStartedHere;
    }
  } else {
    if (doc.complete || doc.invoiceReceipt) throw question('Подтверждённая ранее квитанция счёта больше недоступна.', INVOICE_RESOLVE);
    const matches = await all(api, invoiceEndpoint, { supplierId: doc.parties.supplierId, q: p.number });
    if (matches.some((item) => nameKey(item.no) === nameKey(p.number) && item.supplierId === doc.parties.supplierId)) {
      throw question('По полному номеру найден существующий счёт этого поставщика.', INVOICE_RESOLVE);
    }
    // Сервер отдельно проверяет удалённые и legacy записи до транзакции.
    if (p.revision) throw question('В первичном счёте указана редакция.', 'Загрузите редакцию через существующую карточку счёта после сравнения сумм и состава.');
    await recoverFile(api, doc, bytes, name, save, null);
    doc.headerPayload = immutableRequest(doc.headerPayload, makeInvoicePayload(doc));
    await save();
    const saved = await api.post(invoiceIntake, doc.headerPayload);
    assertInvoiceReceipt(saved, doc);
    receipt = await api.get(lookup, undefined, true);
    if (!receipt) throw new IntakeError('API_UNAVAILABLE', 'DataCore не вернул квитанцию нового счёта.', 'Откройте «Снабжение» и возобновите разбор в том же контуре.');
    assertInvoiceReceipt(receipt, { ...doc, entityId: saved.invoiceId, invoiceReceipt: saved });
    entity = await invoiceDetail(api, receipt);
  }
  await invoiceProof(api, doc, bytes, receipt, entity);
  if (doc.complete) return 'duplicate';
  doc.entityId = receipt.invoiceId;
  doc.invoiceReceipt = receipt;
  doc.complete = true;
  await save();
  return doc.adopted ? 'duplicate' : 'imported';
}

export async function executeIntake({ api, doc, bytes, name, save }) {
  if (doc.proposal.kind === 'supplier_invoice') return executeInvoice({ api, doc, bytes, name, save });
  const p = doc.proposal;
  const endpoint = pathFor(p);
  if (doc.complete) {
    const fresh = await api.get(`${endpoint}/${doc.entityId}`, undefined, true);
    await finalProof(api, doc, bytes, fresh);
    return 'duplicate';
  }

  if (!doc.parties) {
    doc.parties = { companyId: await resolveParty(api, p.seller, true), counterpartyId: await resolveParty(api, p.buyer, false) };
    await save();
  }
  let entity = doc.entityId ? await api.get(`${endpoint}/${doc.entityId}`, undefined, true) : await candidates(api, doc);
  if (doc.entityId && !entity) throw question('Найденный ранее документ больше недоступен или удалён.', RESOLVE);
  await recoverFile(api, doc, bytes, name, save, entity);
  if (entity && !doc.headerPayload && !doc.entityId) {
    // Чужой уже существующий документ подтверждаем целиком, добавлять в него недостающие строки нельзя.
    doc.adopted = true;
  }
  if (!entity) {
    doc.headerPayload = immutableRequest(doc.headerPayload, makePayload(doc));
    await save();
    const saved = await api.post(endpoint, doc.headerPayload);
    const entityId = idOf(saved);
    if (!objectId(entityId)) throw new IntakeError('API_UNAVAILABLE', 'DataCore не вернул идентификатор документа.');
    doc.entityId = entityId;
    await save();
    entity = await api.get(`${endpoint}/${entityId}`, undefined, true);
  }
  assertHeader(entity, doc);
  doc.entityId = idOf(entity);
  await save();
  if (p.kind === 'contract' && !doc.adopted) await saveIncomeLines(api, doc, entity, save);
  const final = await api.get(`${endpoint}/${doc.entityId}`, undefined, true);
  await finalProof(api, doc, bytes, final);
  doc.complete = true;
  await save();
  return doc.adopted ? 'duplicate' : 'imported';
}
