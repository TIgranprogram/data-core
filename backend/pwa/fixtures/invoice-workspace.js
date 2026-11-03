// Проверка выполняется ДО импорта приложения. Ни одного обращения к настоящему fetch.
if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('Fixture разрешена только на localhost');
const query = new URL(location.href).searchParams;
const scenario = query.get('scenario') || 'issued';
const moneyAllowed = scenario !== 'money=false' && query.get('money') !== 'false';
if (query.get('theme') === 'dark') document.documentElement.dataset.theme = 'dark';
const clone = (value) => JSON.parse(JSON.stringify(value));
const trace = [], failures = [];
let failRefresh = false, version = 7;
const lines = [
  { id: 'line-1', num: 101, title: 'Болт М10 — точная сумма 100 / 3', materialName: 'Болт М10', qty: 3, unit: 'шт', priceHint: 100, lineAmount: 100, status: 'ordered', invoiceId: 'fixture-invoice', invoiceNo: 'Ф-101', supplierId: 'supplier', supplierName: 'Тестовый поставщик' },
  { id: 'line-2', num: 102, title: 'Шайба М10', qty: 5, unit: 'шт', priceHint: 50, lineAmount: 50, status: 'ordered', invoiceId: 'fixture-invoice', invoiceNo: 'Ф-101', supplierId: 'supplier', supplierName: 'Тестовый поставщик' },
];
const invoice = { id: 'fixture-invoice', no: 'Ф-101', date: '2026-11-03', supplierId: 'supplier', supplierName: 'Тестовый поставщик', payerCompanyId: 'payer', payerName: 'Тестовая компания', status: scenario === 'draft' ? 'draft' : scenario === 'cancelled' ? 'cancelled' : scenario === 'paid' ? 'paid' : 'issued', version, amount: 150, requests: scenario === 'empty' ? [] : lines, requestsCount: scenario === 'empty' ? 0 : 2, files: [], fileIds: [], orders: [], paymentAdjustments: [] };
if (scenario === 'empty') invoice.amount = 0;
if (scenario === 'paid') {
  invoice.requests.forEach((line) => { line.status = 'paid'; line.paid = true; });
  invoice.paymentSnapshot = { amount: 140, paidAt: '2026-11-01' };
  invoice.paymentAdjustments = [{ at: '2026-11-02', reason: 'Уточнение суммы', delta: 10 }];
}
if (scenario === 'receiptBoundaryAt') invoice.receiptBoundaryAt = '2026-11-01T10:00:00Z'; // видимые строки НЕ received
if (scenario === 'received') invoice.requests[0].status = 'received';
if (scenario === 'partial') { invoice.partial = true; invoice.requests = [lines[1]]; invoice.amount = 50; invoice.requestsCount = 1; }
const candidates = Array.from({ length: 251 }, (_, i) => ({ id: 'candidate-' + (i + 1), num: 201 + i, title: `Свободная заявка ${i + 1}`, qty: 1, unit: 'шт', status: 'requested', priceHint: 10, supplierId: 'supplier', supplierName: 'Тестовый поставщик', ...(i < 200 ? { invoiceId: 'other-invoice' } : {}) }));
const result = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let user = { id: 'fixture-user', role: 'manager', roleLabel: 'Менеджер', displayName: 'Локальная проверка', canMoney: moneyAllowed, sections: ['requests', 'stock', 'partners', 'salesorders'], uiPrefs: {} };
window.addEventListener('error', (event) => failures.push(String(event.error || event.message)));
window.addEventListener('unhandledrejection', (event) => failures.push(String(event.reason)));
window.fetch = async (input, options = {}) => {
  const url = new URL(String(input), location.href), path = url.pathname.includes('/api/') ? url.pathname.split('/api')[1] : url.pathname;
  const method = options.method || 'GET';
  let body = null; try { body = options.body && !(options.body instanceof FormData) ? JSON.parse(options.body) : null; } catch { return result({ message: 'Неизвестное тело fixture' }, 400); }
  trace.push({ path, method, query: Object.fromEntries(url.searchParams), body: clone(body), at: Date.now() });
  if (method === 'GET' && path === '/auth/me') return result(user);
  if (method === 'GET' && path === '/me/counters') return result({ requests: lines.length });
  if (method === 'GET' && path === '/me/versions') return result({});
  if (path === '/client-errors' && method === 'POST') { failures.push(body); return result({}); }
  if (method === 'GET' && path.endsWith('/version.json')) return result({ version: 'fixture' });
  if (method === 'GET' && path === '/supply/lookups') return result({ suppliers: [{ value: 'supplier', label: invoice.supplierName }], units: ['шт'], categories: [] });
  if (method === 'GET' && path === '/incomes/lookups') return result({ companies: [{ id: 'payer', name: invoice.payerName }] });
  if (method === 'GET' && path === '/supply/contracts') return result({ items: [{ id: 'contract', no: 'Д-1', date: '2026-10-01' }], total: 1 });
  if (method === 'GET' && path === '/supply/invoices') return result({ items: [{ ...invoice, requests: undefined }], total: 1, sum: invoice.amount, page: 1, limit: 30 });
  if (method === 'GET' && path === '/supply/invoices/fixture-invoice') {
    if (failRefresh) { failRefresh = false; return result({ message: 'Тестовый сбой обновления показа' }, 400); }
    return result(invoice);
  }
  if (method === 'GET' && path === '/supply/invoices/existing-invoice') return result({ ...invoice, id: 'existing-invoice', no: 'Дубль' });
  if (method === 'GET' && path === '/supply/requests') {
    if (url.searchParams.get('status') === 'requested,in_progress,paid') {
      const search = url.searchParams.get('search') || '', all = candidates.filter((line) => !search || line.title.toLowerCase().includes(search.toLowerCase()));
      const page = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 50);
      return result({ items: all.slice((page - 1) * limit, page * limit), total: all.length, page, limit });
    }
    return result({ items: invoice.requests, total: invoice.requests.length, counts: { ordered: invoice.requests.length }, page: 1, limit: 30 });
  }
  if (method === 'GET' && /^\/supply\/requests\//.test(path)) return result(invoice.requests.find((line) => path.endsWith('/' + line.id)) || lines[0]);
  if (method === 'GET' && path === '/partners') return result({ items: [{ id: 'supplier', name: invoice.supplierName, kind: 'supplier' }], total: 1 });
  if (method === 'GET' && path === '/stock/warehouses') return result([{ id: 'warehouse', name: 'Тестовый склад' }]);
  if (method === 'GET' && path === '/dicts') return result({ items: [] });
  if (method === 'GET') return result({ items: [], total: 0, counts: {}, categories: [], suppliers: [], companies: [] });
  if (path.startsWith('/supply/invoices/')) {
    if (['cancelled', 'partial'].includes(scenario)) return result({ message: 'Счёт доступен только для просмотра' }, 403);
    if (scenario === '409' && !(method === 'PATCH' && !path.includes('/lines/') && body?.duplicateReason)) return result({ message: 'Счёт изменился. Обновите данные', existingInvoiceId: 'existing-invoice' }, 409);
    if (method === 'PATCH' && /\/lines\//.test(path)) {
      if (body.version !== invoice.version) return result({ message: 'Счёт изменился. Обновите данные' }, 409);
      const line = invoice.requests.find((x) => path.endsWith('/' + x.id));
      if (!line) return result({ message: 'Позиция не найдена' }, 404);
      const delta = body.lineAmount - line.lineAmount; Object.assign(line, { qty: body.qty, lineAmount: body.lineAmount, priceHint: body.lineAmount });
      if (invoice.status === 'paid') invoice.paymentAdjustments.push({ at: '2026-11-03', reason: body.reason, delta });
    } else if (method === 'PATCH') { Object.assign(invoice, body); if (body.issue) { invoice.status = 'issued'; delete invoice.issue; } }
    else if (method === 'DELETE') invoice.requests = invoice.requests.filter((x) => !path.endsWith('/' + x.id));
    else if (path.endsWith('/requests')) invoice.requests.push(...candidates.filter((x) => body.requestIds.includes(x.id)).map((x) => ({ ...x, invoiceId: invoice.id, status: invoice.status === 'paid' ? 'paid' : 'ordered', lineAmount: x.priceHint })));
    else if (path.endsWith('/pay')) { invoice.status = 'paid'; invoice.paymentSnapshot = { amount: invoice.amount, paidAt: '2026-11-03' }; }
    else if (path.endsWith('/receive')) { invoice.receiptBoundaryAt = '2026-11-03T10:00:00Z'; invoice.requests.filter((x) => body.requestIds.includes(x.id)).forEach((x) => { x.status = 'received'; }); }
    else return result({ message: 'Неописанная запись fixture заблокирована' }, 403);
    invoice.version = ++version; invoice.amount = invoice.requests.filter((line) => line.status !== 'cancelled').reduce((sum, line) => sum + Number(line.lineAmount ?? line.priceHint), 0); invoice.requestsCount = invoice.requests.length;
    if (scenario === 'refresh-error') failRefresh = true;
    return result(invoice);
  }
  return result({ message: 'Любая неописанная запись fixture запрещена' }, 403);
};
const { session, events } = await import('../core/api.js');
Object.defineProperties(session, {
  access: { get: () => 'fixture-only', set: () => {} }, refresh: { get: () => 'fixture-only', set: () => {} },
  user: { get: () => user, set: (value) => { user = value; } },
});
events.onAuthLost = () => { throw new Error('Fixture не использует настоящую авторизацию'); };
window.__invoiceFixture = { scenario, trace, failures, invoice, clearTrace: () => { trace.length = 0; }, writes: () => trace.filter((event) => event.method !== 'GET' && event.path.startsWith('/supply/')) };
if (!location.hash) location.hash = '#requests?tab=invoices&of=invoicecard&open=fixture-invoice';
await import('../main.js'); // настоящие main lazy, router, openCard, modules и kit

export {}; // checker и браузер трактуют fixture как ES-модуль
