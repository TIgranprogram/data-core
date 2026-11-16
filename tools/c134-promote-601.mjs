// C134: перенести исправленные строки паспорта № 601 в справочники (разовая запись на прод, запускает пользователь из пульта).
// Переносятся только правки, верные для всех затронутых изделий (см. docs/crew/C134-passport-book-editor/FIX-601-REPORT.md «Справочники»).
// Каждая строка: сначала предпросмотр /target (источник, сколько изделий), затем /promote с токеном. Выданные паспорта не меняются.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ID = '6af716ffd8ab283a37473bc9';
const MAX_AFFECTED = { default: 1, care: 172 }; // общий справочник — только 6.3 (172 изделия, проверено 2026-11-16)
const F = (field, index) => ({ kind: 'snapshot-field', key: { field, ...(index === undefined ? {} : { index }) } });
const I = (sectionKey, itemKey) => ({ kind: 'snapshot-item', key: { sectionKey, itemKey } });
const JOBS = [
  ['Описание', F('description')],
  ['Назначение', F('purpose')],
  ['Правило 4', F('rules', 3)],
  ['Правило 5', F('rules', 4)],
  ['Правило 6', F('rules', 5)],
  ['Обслуживание, строка 5', F('maintenance', 4)],
  ['Обслуживание, строка 6', F('maintenance', 5)],
  ['Обслуживание, строка 8', F('maintenance', 7)],
  ['Пункт 6.3', I('care', 'p3'), 'care'],
];

const tmp = path.join(os.tmpdir(), 'c134-promote-body.json');
const api = (method, url, body) => {
  fs.writeFileSync(tmp, JSON.stringify(body ?? {}));
  const out = execFileSync('bash', ['deploy/synology/api.sh', 'prod', method, url, ...(body ? [tmp] : [])], { encoding: 'utf8' });
  try { return JSON.parse(out); } catch { throw new Error(out.slice(0, 300)); }
};

const p = api('GET', `/api/passports/${ID}`);
const snap = p.textSnapshot || {};
const text = (job) => {
  const { kind, key } = job;
  if (kind === 'snapshot-item') return (snap.sections || []).find((s) => s.key === key.sectionKey)?.items?.find((i) => i.key === key.itemKey)?.text;
  const t = snap;
  if (key.field === 'maintenance') return (t.maintenance || []).flatMap((x) => x.rows || [])[key.index]?.what;
  const v = t[key.field];
  return Array.isArray(v) ? v[key.index] : (typeof v === 'object' && v ? v.text : v);
};

let ok = 0, skip = 0, bad = 0;
for (const [label, job, limitKey] of JOBS) {
  const t = text(job);
  if (!t) { console.log(`ПРОПУСК ${label}: текст в паспорте не найден`); skip++; continue; }
  try {
    const base = `/api/passports/${ID}/${job.kind}`;
    const tg = api('POST', base + '/target', { ...job.key, text: t });
    const limit = MAX_AFFECTED[limitKey || 'default'];
    if (!(tg.affected <= limit)) { console.log(`ПРОПУСК ${label}: затронет ${tg.affected} изделий (ожидалось ≤ ${limit}) — не переношу`); skip++; continue; }
    api('POST', base + '/promote', { ...job.key, text: t, token: tg.token });
    console.log(`ОК ${label} → ${tg.target} (изделий: ${tg.affected})`); ok++;
  } catch (e) { console.log(`ОШИБКА ${label}: ${String(e.message).slice(0, 200)}`); bad++; }
}
fs.rmSync(tmp, { force: true });
console.log(`Итог: перенесено ${ok}, пропущено ${skip}, ошибок ${bad}`);
process.exit(bad ? 1 : 0);
