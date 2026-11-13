#!/usr/bin/env node
/**
 * Уборка тестовых данных (решение пользователя 2026-10-28: «все тестовые данные на боевом можно убрать»).
 *   node scripts/cleanup-test-data.js <local|prod>                            - план, ничего не пишет
 *   node scripts/cleanup-test-data.js <local|prod> --apply --out откат.json   - DELETE через API (мягко, в корзину)
 *   --with-disputed  - не нужен для удаления: спорное НИКОГДА не удаляется, только печатается
 * Откат: для каждой удалённой записи {coll, id, label, restore}; POST restore-эндпоинт (паспорта/заявки) или
 * восстановление из корзины приложения. Прямых записей в Mongo нет; CRM-коллекции без своего API не трогаем.
 * Разделы: заявки (supply/requests), склад (stock/items), заказы (salesorders), позиции (incomes), контрагенты,
 * изделия (showcase), задачи проектирования (design-tasks), паспорта. Деньги: суммы живут в позициях/заказах
 * (отдельной таблицы платежей в API нет) - сумма 1/111/12345 считается признаком, но только вместе с текстом - иначе СПОРНОЕ.
 * Смоук выкладки (deploy/synology/release.sh) только читает (GET health/app/admin) - записей не создаёт.
 * Уверенное = слово-метка в названии/заказчике/примечании ИЛИ clientUid e2e:/smoke:. Остальное - СПОРНОЕ.
 */
const fs = require('fs');
const path = require('path');

// ---------- правила (чистые функции) ----------
const WORD = /(^|[^a-zа-яё0-9])(тест\w*|test\w*|проверк\w*|пример\w*|asdf\w*|qwe\w*|qwerty\w*|e2e\w*|smoke\w*|xxx+|ааа+|фыв\w*|123|1234|12345|111)(?=$|[^a-zа-яё0-9])/i;
const STRONG = /(^|[^a-zа-яё0-9])(тест\w*|test\w*|asdf\w*|qwe\w*|qwerty\w*|e2e\w*|smoke\w*)(?=$|[^a-zа-яё0-9])/i; // однозначные
const UID = /^(e2e|smoke):/i;
const TEST_SUMS = new Set([1, 111, 12345]);
const BLANK_REQ = /^\s*новая заявка\s*$/i;

/** -> {verdict:'sure'|'disputed'|null, why:[...]} по набору текстовых полей {поле: значение}. */
function judge(texts, extra = {}) {
  const why = []; let sure = false;
  if (extra.clientUid && UID.test(extra.clientUid)) { why.push(`clientUid ${extra.clientUid}`); sure = true; }
  for (const [f, v] of Object.entries(texts)) {
    if (typeof v !== 'string' || !v) continue;
    const s = v.match(STRONG);
    if (s) { why.push(`${f}: «${s[2]}»`); sure = true; continue; }
    const w = v.match(WORD);
    if (w) why.push(`${f}: «${w[2]}» (слабый признак)`);
  }
  if (extra.blank) why.push('«Новая заявка» без полей');
  if (extra.sum != null && TEST_SUMS.has(Number(extra.sum))) why.push(`сумма ${extra.sum}`);
  if (!why.length) return { verdict: null, why };
  // «Новая заявка» без полей и без привязок - уверенно; слабые слова и суммы - спорно
  if (sure || extra.blank) return { verdict: 'sure', why };
  return { verdict: 'disputed', why };
}

// ---------- разделы ----------
// list: путь списка; del: путь DELETE; restore: путь restore (если есть); label/texts/extra - из записи.
const SECTIONS = [
  { coll: 'supply/requests', name: 'Заявки', list: '/api/supply/requests', del: '/api/supply/requests/', restore: (id) => `/api/supply/requests/${id}/restore`,
    label: (r) => `№${r.num ?? '?'} ${r.title || '(без названия)'}`,
    texts: (r) => ({ title: r.title, note: r.note, requestedBy: r.requestedBy, customer: r.customer }),
    extra: (r) => ({ clientUid: r.clientUid, sum: r.priceHint,
      blank: BLANK_REQ.test(r.title || '') && !r.materialId && !r.article && !r.supplierId && !(Number(r.qty) > 0 && r.qty !== 1) && !r.note }) },
  { coll: 'stock/items', name: 'Склад (позиции)', list: '/api/stock/items', del: '/api/stock/items/',
    label: (r) => `${r.article || ''} ${r.name || ''}`.trim(), texts: (r) => ({ name: r.name, article: r.article, note: r.note, code: r.code }), extra: () => ({}) },
  { coll: 'salesorders', name: 'Заказы', list: '/api/salesorders', del: '/api/salesorders/', qs: 'filter=all',
    label: (r) => `№${r.orderNo || '?'} ${r.customer || ''}`.trim(), texts: (r) => ({ orderNo: r.orderNo, customer: r.customer, subject: r.subject, notes: r.notes, contractNo: r.contractNo }), extra: () => ({}) },
  { coll: 'incomes', name: 'Позиции заказов (и деньги)', list: '/api/incomes', del: '/api/incomes/',
    label: (r) => `${r.orderNo || '?'}/${r.lineNo || '?'} ${r.title || ''}`.trim(), texts: (r) => ({ title: r.title, customer: r.customer, notes: r.notes, orderNo: r.orderNo }), extra: (r) => ({ sum: r.amount }) },
  { coll: 'counterparties', name: 'Контрагенты', list: '/api/counterparties', del: '/api/counterparties/',
    label: (r) => `${r.name || ''}${r.inn ? ' ИНН ' + r.inn : ''}`, texts: (r) => ({ name: r.name, shortName: r.shortName, email: r.email }), extra: () => ({}) },
  { coll: 'showcase', name: 'Изделия', list: '/api/showcase', del: '/api/showcase/',
    label: (r) => `${r.sku || ''} ${r.name || ''}`.trim(), texts: (r) => ({ name: r.name, orderName: r.orderName, fullName: r.fullName, sku: r.sku }), extra: () => ({}) },
  { coll: 'design-tasks', name: 'Задачи проектирования', list: '/api/design-tasks', del: '/api/design-tasks/',
    label: (r) => `D-${r.seq ?? '?'} ${r.title || ''}`.trim(), texts: (r) => ({ title: r.title, note: r.note }), extra: () => ({}) },
  { coll: 'passports', name: 'Паспорта', list: '/api/passports', del: '/api/passports/', restore: (id) => `/api/passports/${id}/restore`,
    label: (r) => `№${r.passportNo ?? '?'} ${r.name || ''}`.trim(), texts: (r) => ({ name: r.name, customer: r.customer, orderNo: r.orderNo, object: r.object }), extra: () => ({}) },
];
module.exports = { judge, SECTIONS, WORD, STRONG };
if (require.main === module) main();

// ---------- CLI ----------
function main() {
  const [env, ...flags] = process.argv.slice(2);
  if (!['local', 'prod'].includes(env)) { console.error('usage: <local|prod> [--apply --out откат.json]'); process.exit(2); }
  const APPLY = flags.includes('--apply');
  const OUT = flags[flags.indexOf('--out') + 1];
  if (APPLY && (!OUT || OUT.startsWith('--'))) { console.error('--apply требует --out откат.json'); process.exit(2); }
  const BASE = env === 'prod' ? 'https://kppdf-crm.ru/db' : 'http://localhost:3001';

  function creds() {
    const d = path.join(__dirname, '../../deploy/synology');
    const get = (k, f) => { try { const m = fs.readFileSync(path.join(d, f), 'utf8').match(new RegExp(`^${k}=(.*)$`, 'm')); return m ? m[1].replace(/["\r]/g, '') : ''; } catch { return ''; } };
    return { username: get('ACCESS_USER', 'access.env') || 'admin', password: get('ACCESS_PASSWORD', 'access.env') || get('ADMIN_PASSWORD', 'config.env') };
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let token = '';
  async function login() {
    const c = creds();
    if (!c.password) throw new Error('нет пароля (config.env / access.env)');
    const j = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) }).then((r) => r.json());
    token = j.access || j.tokens?.access;
    if (!token) throw new Error('вход не удался');
  }
  async function api(method, p, body) {
    for (let i = 0; ; i++) {
      await sleep(700); // лимит 100/мин
      const r = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 429 && i < 5) { await sleep(15000); continue; }
      if (r.status === 401 && i < 2) { await sleep(13000); await login(); continue; } // перевход только на 401 (лимит входа 20/час)
      const txt = await r.text();
      let j; try { j = JSON.parse(txt); } catch { j = txt; }
      if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${typeof j === 'object' ? j.message : txt.slice(0, 200)}`);
      return j;
    }
  }
  async function all(p, qs) {
    const out = [];
    for (let page = 1; ; page++) {
      const r = await api('GET', `${p}?limit=200&page=${page}${qs ? '&' + qs : ''}`);
      const items = Array.isArray(r) ? r : (r.items || []);
      out.push(...items);
      if (Array.isArray(r) || out.length >= (r.total ?? 0) || !items.length) break;
    }
    return out;
  }
  const who = (r) => `${r.createdByName || r.createdBy?.name || r.createdBy || r.requestedBy || '?'} / ${String(r.createdAt || '').slice(0, 10) || '?'}`;

  (async () => {
    await login();
    const plan = []; // {sec, id, label, who, why, verdict}
    for (const sec of SECTIONS) {
      let rows;
      try { rows = await all(sec.list, sec.qs); } catch (e) { console.log(`\n[${sec.name}] не прочитано: ${e.message}`); continue; }
      let n = 0;
      for (const r of rows) {
        if (r.deletedAt) continue;
        const j = judge(sec.texts(r), sec.extra(r));
        if (!j.verdict) continue;
        n++; plan.push({ sec, id: r.id, label: sec.label(r), who: who(r), why: j.why.join('; '), verdict: j.verdict });
      }
      console.log(`[${sec.name}] прочитано ${rows.length}, признаков ${n}`);
    }
    for (const v of ['sure', 'disputed']) {
      const list = plan.filter((p) => p.verdict === v);
      console.log(`\n=== ${v === 'sure' ? 'УВЕРЕННЫЕ (удалятся с --apply)' : 'СПОРНЫЕ (не удаляются, решает пользователь)'}: ${list.length} ===`);
      for (const sec of SECTIONS) {
        const s = list.filter((p) => p.sec === sec);
        if (!s.length) continue;
        console.log(`\n-- ${sec.name}: ${s.length}`);
        s.forEach((p) => console.log(`   ${p.id}  ${p.label}  [${p.who}]  ← ${p.why}`));
      }
    }
    if (!APPLY) return console.log('\nплан - ничего не удалено; запуск: --apply --out откат.json');

    const log = [];
    try {
      for (const p of plan.filter((x) => x.verdict === 'sure')) {
        await api('DELETE', p.sec.del + p.id);
        log.push({ coll: p.sec.coll, id: p.id, label: p.label, restore: p.sec.restore ? p.sec.restore(p.id) : 'корзина приложения' });
      }
    } finally { fs.writeFileSync(OUT, JSON.stringify(log, null, 1)); }
    console.log(`\nготово: удалено (в корзину) ${log.length}; откат - ${OUT}`);
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
