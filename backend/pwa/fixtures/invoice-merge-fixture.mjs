import { invoiceMergeData } from './invoice-merge-data.mjs';

// Стоп до загрузки приложения и любых записей в storage на нелокальном адресе.
if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('Fixture разрешён только на localhost');
const data = invoiceMergeData(), calls = [];
let mode = 'normal', getFailed = false, postFailed = false, merged = false;
let log;
const result = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Никакой передачи в настоящий fetch: все неописанные запросы закрыты локальным 403.
window.fetch = async (url, options = {}) => {
  const u = new URL(String(url), location.href), path = u.pathname.replace(/^.*\/api/, '');
  const method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : null;
  calls.push({ path, method, body }); paintCalls();
  if (method === 'GET' && path.endsWith('/merge-preview')) {
    if (mode === 'get-error' && !getFailed) { getFailed = true; return result({ message: 'Тестовый отказ загрузки preview' }, 400); }
    return merged ? result({}, 404) : result(data.preview);
  }
  if (method === 'GET' && path === '/incomes/lookups') return result({ companies: [{ id: 'payer', name: 'Тестовая компания' }] });
  if (method === 'GET' && path === '/supply/invoices/source') return merged ? result({}, 404) : result(data.source);
  if (method === 'GET' && path === '/supply/invoices/target') return result(data.target);
  if (method === 'PATCH' && path === '/supply/invoices/source') {
    if (body.duplicateReason) return result({ ...data.source, ...body });
    return result({ message: 'Счёт № 102 уже есть', existingInvoiceId: 'target', existingNo: '102', existingStatus: 'issued' }, 409);
  }
  if (method === 'POST' && path === '/supply/invoices/source/merge') {
    if (mode === 'post-error' && !postFailed) { postFailed = true; throw new TypeError('Failed to fetch'); }
    merged = true; return result({ targetInvoiceId: 'target', moved: 2, skipped: 0, replaced: 0 });
  }
  return result({ message: 'Неизвестный запрос fixture заблокирован' }, 403);
};

const { h } = await import('../core/dom.js');
const { session, events } = await import('../core/api.js');
const { button, actions, section } = await import('../ui/kit/index.js');
const { patchInvoiceWithDuplicate, invoiceBlock } = await import('../sections/request-step.js');
const showMoney = new URL(location.href).searchParams.get('money') !== '0';
Object.defineProperties(session, { access: { get: () => '' }, refresh: { get: () => '' }, user: { get: () => ({ role: 'manager', canMoney: showMoney }) } });
events.onAuthLost = () => { throw new Error('Fixture не использует авторизацию'); };
log = h('pre', null);
const panel = h('div', null), summary = h('p', { class: 'hint' });
function paintCalls() { if (log) log.textContent = calls.map((x) => `${x.method} ${x.path}${x.body ? ' ' + JSON.stringify(x.body) : ''}`).join('\n'); }
const scenarios = h('select', { value: mode, 'aria-label': 'Сценарий' },
  ...[['normal', '409 → preview'], ['get-error', 'Ошибка GET → обновить preview'], ['post-error', 'Сетевая ошибка POST → новое подтверждение'], ['snapshot', 'Оплаченный счёт: snapshot и текущая сумма']].map(([value, title]) => h('option', { value }, title)));
function reset() {
  mode = scenarios.value; getFailed = false; postFailed = false; merged = false; calls.length = 0;
  Object.assign(data, invoiceMergeData());
  if (mode === 'snapshot') { data.source.status = 'paid'; data.source.paymentSnapshot = { amount: 250, paidAt: '2026-10-30' }; data.source.paymentAdjustments = [{ at: '2026-11-01', reason: 'Уточнение цены', delta: 50 }]; }
  panel.replaceChildren(invoiceBlock({ invoiceId: 'source' }, { changed() {} })); paintCalls(); summary.textContent = 'Синтетические данные. API и service worker production не используются.';
}
scenarios.addEventListener('change', reset);
document.getElementById('fixture').replaceChildren(h('h1', null, 'T25 — изолированная проверка'),
  h('label', { class: 'field' }, h('span', null, 'Сценарий'), scenarios),
  actions(button({ label: 'Начать с 409', kind: 'primary', onClick: async () => { reset(); await patchInvoiceWithDuplicate(data.source, { no: '102' }); summary.textContent = merged ? 'Подтверждено: один явный POST merge.' : 'Без merge. Проверяйте журнал запросов.'; } }),
    button({ label: 'Тема', onClick: () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; } }),
    button({ label: 'Сбросить', onClick: reset })), summary, panel,
  section({ title: 'Журнал запросов fixture', open: true, body: log }));
reset();
