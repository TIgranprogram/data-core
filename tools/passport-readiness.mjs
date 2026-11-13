#!/usr/bin/env node
// C112 Э0: замер «паспорт без ручного ввода» — только чтение.
//   node tools/passport-readiness.mjs [stand|local|prod] [--json]
// По каждому изделию с типом паспорта (ppCategory в /showcase):
//   GET /showcase/:id/passport-gaps — обязательные пробелы (есть ли умолчание типа паспорта);
//   POST /passports/check {productId, mode:'template'} — разделы-выборы (choice:*) без варианта.
//   POST check ничего не пишет, но на прод его не шлём (правило api.sh): для prod выборы не считаются.
// Итог: tools/logs/passport-readiness-<env>.json и сводка в stdout. Код выхода: 0 норма, 2 сбой.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = ['stand', 'local', 'prod'].includes(process.argv[2]) ? process.argv[2] : 'stand';
const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const tmp = path.join(ROOT, 'tools', 'logs', 'passport-readiness-body.json');

function call(method, p, body) {
  const args = ['deploy/synology/api.sh', env, method, p];
  if (body) { fs.writeFileSync(tmp, JSON.stringify(body)); args.push(tmp); }
  const r = spawnSync(fs.existsSync(bash) ? bash : 'bash', args, { cwd: ROOT, encoding: 'utf8', timeout: 90000, windowsHide: true });
  if (r.status !== 0) throw new Error(`${method} ${p}: ${(r.stderr || r.stdout || '').trim().slice(0, 200)}`);
  return JSON.parse(r.stdout);
}

/** Пробелы одного изделия → { ready, defaultsOnly, reasons[] }. Чистая функция (тест — passport-readiness.test.mjs). */
export function classify(gaps, check) {
  const hard = [];
  let defaults = 0;
  for (const m of gaps?.missing || []) {
    if (!m.required) continue;
    if (m.default !== undefined && m.default !== null && m.default !== '') { defaults++; continue; }
    hard.push(m.kind === 'category' ? 'Тип паспорта' : m.label || m.key);
  }
  const choices = (check?.missing || []).filter((m) => String(m.key || '').startsWith('choice:')).map((m) => 'Выбор: ' + (m.label || m.key));
  const reasons = [...hard, ...choices];
  return { ready: !reasons.length && !defaults, defaultsOnly: !reasons.length && defaults > 0, reasons, defaults };
}

async function main() {
  const prods = [];
  for (let page = 1; ; page++) {
    const d = call('GET', `/api/showcase?limit=200&page=${page}`);
    prods.push(...(d.items || []));
    if (!d.items?.length || prods.length >= (d.total || 0)) break;
  }
  const typed = prods.filter((p) => p.ppCategory);
  const rows = [];
  let fails = 0;
  for (const p of typed) {
    try {
      const gaps = call('GET', `/api/showcase/${p.id}/passport-gaps`);
      const check = env === 'prod' ? null : call('POST', '/api/passports/check', { productId: p.id, mode: 'template' });
      rows.push({ id: p.id, sku: p.sku, name: p.name, category: p.ppCategory, ...classify(gaps, check) });
    } catch (e) { fails++; rows.push({ id: p.id, sku: p.sku, name: p.name, error: String(e.message).slice(0, 160) }); }
  }
  fs.rmSync(tmp, { force: true });
  const ok = rows.filter((r) => !r.error);
  const by = new Map();
  for (const r of ok) for (const x of new Set(r.reasons)) by.set(x, (by.get(x) || 0) + 1);
  const res = {
    env, date: new Date().toISOString(), products: prods.length, typed: typed.length, measured: ok.length, fails,
    ready: ok.filter((r) => r.ready).length, defaultsOnly: ok.filter((r) => r.defaultsOnly).length,
    reasons: [...by.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => ({ reason, n })),
    choicesCounted: env !== 'prod', rows,
  };
  fs.writeFileSync(path.join(ROOT, 'tools', 'logs', `passport-readiness-${env}.json`), JSON.stringify(res, null, 1));
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ ...res, rows: undefined })); return 0; }
  console.log(`Изделий ${res.products}, с типом паспорта ${res.typed}, замерено ${res.measured}, сбоев ${fails}`);
  console.log(`Готовы без ввода: ${res.ready} · держатся только на умолчаниях: ${res.defaultsOnly}`);
  for (const x of res.reasons.slice(0, 12)) console.log(`  ${x.n} — ${x.reason}`);
  console.log(`Полный итог: tools/logs/passport-readiness-${env}.json`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then((c) => process.exit(c), (e) => { console.error('Сбой: ' + e.message); process.exit(2); });
}
