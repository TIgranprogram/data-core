#!/usr/bin/env node
/**
 * Переход «Склад» с Google-таблицы на приложение (C3): табличные остатки → журнал движений.
 *
 * Для каждой позиции warehouse/items, у которой ещё нет движений (fromMovements != true):
 *   currentQty > 0  → движение «opening» (начальный остаток) на это количество;
 *   reservedQty > 0 → движение «reserve» (бронь);
 *   затем позиция помечается fromMovements: true — дальше остатки считаются только из движений.
 * Идемпотентно: uid движений детерминированы (opening-<uid позиции>), повторный запуск ничего не задвоит.
 *
 * Запуск (Node 18+), ключ с правами «Чтение и запись» для приложения warehouse:
 *   DATACORE_KEY=kppd_… node deploy/supply-app/cutover.js --base https://kppdf-crm.ru/db/api           # показать план
 *   DATACORE_KEY=kppd_… node deploy/supply-app/cutover.js --base https://kppdf-crm.ru/db/api --apply   # выполнить
 */
'use strict';
const args = process.argv.slice(2);
const BASE = (args[args.indexOf('--base') + 1] || 'http://localhost:3001/api').replace(/\/$/, '');
const APPLY = args.includes('--apply');
const KEY = process.env.DATACORE_KEY;
if (!KEY) { console.error('Задайте DATACORE_KEY=kppd_…'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(BASE + path, { method, headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * attempt); continue; }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
    await sleep(120); // бережём лимит API
    return text ? JSON.parse(text) : null;
  }
  throw new Error(`${method} ${path}: сервер перегружен`);
}
async function listAll(path) {
  const out = [];
  for (let page = 1; page < 500; page++) {
    const r = await api('GET', `${path}?limit=200&page=${page}&sort=createdAt`);
    out.push(...r.items);
    if (out.length >= r.total || !r.items.length) break;
  }
  return out;
}
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

(async () => {
  const items = await listAll('/apps/warehouse/items');
  const moves = await listAll('/apps/warehouse/movements');
  const moved = new Set(moves.map((m) => m.itemUid));
  const existingUids = new Set(moves.map((m) => m.uid));
  const today = new Date().toISOString().slice(0, 10);
  const todo = items.filter((i) => !i.fromMovements && !moved.has(i.uid));
  let opening = 0, reserve = 0, flagged = 0;
  console.log(`Позиций всего: ${items.length}; к переводу на движения: ${todo.length}; режим: ${APPLY ? 'ВЫПОЛНЕНИЕ' : 'план (без изменений)'}`);
  for (const it of todo) {
    const plan = [];
    if (num(it.currentQty) > 0) plan.push({ uid: `opening-${it.uid}`, type: 'opening', qty: num(it.currentQty) });
    if (num(it.reservedQty) > 0) plan.push({ uid: `opening-reserve-${it.uid}`, type: 'reserve', qty: num(it.reservedQty) });
    for (const p of plan) {
      if (existingUids.has(p.uid)) continue;
      const mv = { ...p, itemUid: it.uid, itemName: it.name, date: today, note: 'Перенос из Google-таблицы', byName: 'перенос' };
      if (APPLY) await api('POST', '/apps/warehouse/movements', mv);
      if (p.type === 'opening') opening++; else reserve++;
    }
    if (APPLY) await api('PATCH', `/apps/warehouse/items/${it.id}`, { fromMovements: true });
    flagged++;
  }
  console.log(`${APPLY ? 'Сделано' : 'Будет сделано'}: начальных остатков ${opening}, броней ${reserve}, позиций переведено ${flagged}.`);
  if (!APPLY) console.log('Чтобы выполнить — добавьте --apply.');
})().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
