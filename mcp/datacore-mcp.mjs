#!/usr/bin/env node
/**
 * MCP-сервер «Рабочего места» (TASKS БЗ-3): Claude (Desktop / Code) работает с живыми данными data-core через API.
 * Без внешних библиотек: Node 18+, протокол MCP (JSON-RPC 2.0, по строке на сообщение) через stdin/stdout.
 * Доступ — машинный ключ `kppd_…` (админка → «API-ключи»): «только чтение» — инструменты чтения; запись — create_request.
 *
 *   DATACORE_URL=https://kppdf-crm.ru/db/api  DATACORE_KEY=kppd_…  node mcp/datacore-mcp.mjs
 * Подключение в Claude — mcp/README.md.
 */
const BASE = String(process.env.DATACORE_URL || 'http://localhost:3001/api').replace(/\/+$/, '');
const KEY = process.env.DATACORE_KEY || '';
const VERSION = '1.0.0';

async function call(method, path, { query, body } = {}) {
  if (!KEY) throw new Error('Не задан ключ DATACORE_KEY (kppd_…) — выдайте его в админке → «API-ключи»');
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString() : '';
  const res = await fetch(BASE + path + qs, { method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status}: ${(data && data.message) || text.slice(0, 200)}`);
  return data;
}
const get = (path, query) => call('GET', path, { query });

/** Ответ короче: без служебных полей, обрезка длинных списков (ИИ читает быстрее и дешевле). */
const DROP = new Set(['_id', '__v', 'photoIds', 'photos', 'photo', 'materialPhoto', 'sheetKey', 'sheetSource', 'syncHash', 'editedInApp', 'createdBy', 'updatedBy', 'sheetExtra']);
function slim(v, depth = 0) {
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => slim(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k, x]) => !DROP.has(k) && x !== null && x !== '' && !(Array.isArray(x) && !x.length)).map(([k, x]) => [k, depth > 3 ? x : slim(x, depth + 1)]));
  return v;
}

const TOOLS = [
  { name: 'search', description: 'Найти по всему: заявки снабжения, позиции склада, контрагенты. Слова в любом порядке («м10 гайка»).',
    input: { q: { type: 'string', description: 'что искать' } }, required: ['q'],
    run: async ({ q }) => {
      const [req, stock, sup, cust] = await Promise.all([get('/supply/requests', { search: q, limit: 10 }), get('/stock/items', { search: q, limit: 10 }),
        get('/partners', { search: q }), get('/partners', { search: q, type: 'customer' })]);
      return { заявки: slim(req.items), склад: slim(stock.items), поставщики: slim(sup.items).slice(0, 10), заказчики: slim(cust.items).slice(0, 10) };
    } },
  { name: 'stock_items', description: 'Остатки склада: поиск, состояние (low — к закупке, none — нет, reserved — в брони), остаток / бронь / свободно / заказано.',
    input: { search: { type: 'string' }, status: { type: 'string', enum: ['low', 'none', 'reserved', 'ok'] }, limit: { type: 'number' } },
    run: async (a) => slim((await get('/stock/items', { search: a.search, status: a.status, limit: a.limit || 25 })).items) },
  { name: 'stock_item', description: 'Карточка позиции склада по id: остаток, бронь, заказано (открытые заявки), поставщики и цены, последние движения.',
    input: { id: { type: 'string' } }, required: ['id'],
    run: async ({ id }) => {
      const [item, ordered, moves] = await Promise.all([get(`/stock/items/${id}`), get(`/stock/items/${id}/ordered`), get('/stock/movements', { materialId: id, limit: 15 })]);
      return { позиция: slim(item), заказано: slim(ordered), движения: slim(moves.items) };
    } },
  { name: 'requests', description: 'Заявки снабжения: поиск, статус (in_progress — ожидает, requested — заказать, ordered — в работе, received — получено, cancelled), период по дате заявки.',
    input: { search: { type: 'string' }, status: { type: 'string' }, from: { type: 'string', description: 'ГГГГ-ММ-ДД' }, to: { type: 'string' }, limit: { type: 'number' } },
    run: async (a) => { const r = await get('/supply/requests', { search: a.search, status: a.status, from: a.from, to: a.to, limit: a.limit || 25, sort: '-requestDate' }); return { всего: r.total, сумма: r.sum, по_статусам: r.counts, заявки: slim(r.items) }; } },
  { name: 'create_request', description: 'Создать заявку снабжения (нужен ключ с правом записи). Статус — «Заказать».',
    input: { title: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' }, categoryName: { type: 'string' }, requestedBy: { type: 'string' }, notes: { type: 'string' } }, required: ['title', 'qty'],
    run: async (a) => slim(await call('POST', '/supply/requests', { body: { title: a.title, qty: a.qty, unit: a.unit || 'шт', categoryName: a.categoryName, requestedBy: a.requestedBy, notes: a.notes ? `${a.notes} (через ИИ)` : 'через ИИ', statusLabel: 'Заказать', clientUid: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } })) },
  { name: 'orders', description: 'Заказы заказчиков: в работе (active) / закрытые (done) / все, поиск; позиций, сумма, оплачено.',
    input: { search: { type: 'string' }, filter: { type: 'string', enum: ['active', 'done', 'all'] }, limit: { type: 'number' } },
    run: async (a) => { const r = await get('/salesorders', { search: a.search, filter: a.filter || 'active', limit: a.limit || 25 }); return { всего: r.total, этапы: r.counts, заказы: slim(r.items) }; } },
  { name: 'money_summary', description: 'Деньги за год (факт): поступления, выплаты, результат по месяцам и компаниям, куда и на что тратили, кому платили. Только деньги-ролям ключа.',
    input: { year: { type: 'number' }, org: { type: 'string', description: 'all | СИЮ | ССЮ' } },
    run: async (a) => { const y = a.year || new Date().getFullYear(); const today = new Date().toISOString().slice(0, 10); const to = `${y}-12-31` < today ? `${y}-12-31` : today; return slim(await get('/finance/summary', { from: `${y}-01-01`, to, org: a.org })); } },
  { name: 'money_forecast', description: 'Прогноз денег вперёд: ожидаемые выплаты и поступления по дням, кассовый разрыв, «без срока».',
    input: { days: { type: 'number', description: '7–180, по умолчанию 30' }, opening: { type: 'number', description: 'остаток денег на сегодня, ₽' }, org: { type: 'string' } },
    run: async (a) => { const f = await get('/finance/forecast', { days: a.days || 30, opening: a.opening, org: a.org }); return { ...slim({ ...f, days: undefined }), дни_с_операциями: f.days.filter((d) => d.income || d.expense).map((d) => ({ дата: d.date, поступления: d.income, выплаты: d.expense, остаток: d.closing })) }; } },
  { name: 'fill_queue', description: '«Требуют заполнения»: что не заполнено в данных (по группам) — с чего начать уборку.',
    input: { only: { type: 'string', description: 'ключ группы (необязательно)' } },
    run: async (a) => slim(await get('/fill-audit', { limit: 20, only: a.only })) },
  { name: 'api_get', description: 'Прочитать любой раздел API (только GET): путь без /api, например /stock/categories, /partners?type=customer, /meta/guide — описание всех таблиц.',
    input: { path: { type: 'string' }, query: { type: 'object' } }, required: ['path'],
    run: async ({ path, query }) => { if (!String(path).startsWith('/') || /\.\./.test(path)) throw new Error('Путь — вида /раздел/…'); return slim(await get(path, query)); } },
];

// ---------- MCP: JSON-RPC через stdio ----------
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(m) {
  if (m.method === 'initialize') return reply(m.id, { protocolVersion: m.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'datacore', version: VERSION },
    instructions: 'Данные «Рабочего места» (снабжение, склад, заказы, деньги) компании. Отвечай по-русски, суммы в ₽. Записывать — только create_request и только по просьбе пользователя.' });
  if (m.method === 'ping') return reply(m.id, {});
  if (m.method === 'tools/list') return reply(m.id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: { type: 'object', properties: t.input, required: t.required || [] } })) });
  if (m.method === 'tools/call') {
    const t = TOOLS.find((x) => x.name === m.params?.name);
    if (!t) return fail(m.id, -32602, `Нет инструмента ${m.params?.name}`);
    try { return reply(m.id, { content: [{ type: 'text', text: JSON.stringify(await t.run(m.params.arguments || {}), null, 1) }] }); }
    catch (e) { return reply(m.id, { content: [{ type: 'text', text: 'Ошибка: ' + e.message }], isError: true }); }
  }
  if (m.id !== undefined) fail(m.id, -32601, `Метод ${m.method} не поддерживается`);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { fail(null, -32700, 'Не JSON'); continue; }
    handle(m).catch((e) => fail(m.id ?? null, -32603, e.message));
  }
});
