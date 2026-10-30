#!/usr/bin/env node
/**
 * Импорт остатков металла из таблиц учёта (TASKS СМ.3): позиции склада + один начальный приход.
 *   node scripts/import-metal-stock.js <local|prod> [--with-zero]                          - план, ничего не пишет
 *   node scripts/import-metal-stock.js <local|prod> [--with-zero] --apply --out откат.json - запись
 * Файлы: --sheets <csv> (лист), --pipes <csv> (труба); по умолчанию — «для анализа/» в корне репо.
 * Только через API и только через deploy/synology/api.sh (пароль скрипт не видит): GET /api/stock/items, POST /api/stock/items, POST /api/stock/batch, POST /api/stock/items/:id/offcut.
 * Лист — в листах, труба — в метрах (СМ.2). Мытая и не мытая труба — разные позиции. Нержавеющая труба — по столбцу «Итого».
 * Строки с нулём не создаются (--with-zero — создать). Остаток-обрезок с размером («640х500») — позиция-обрезок;
 * без размера («0.5 ост») — только примечание и строка «уточнить» в отчёте.
 * Идемпотентно: позиция с тем же названием не создаётся и не приходуется, приход защищён clientUid.
 * Откат: POST /api/stock/batch/<batchId>/cancel, затем DELETE /api/stock/items/<id> по --out. Прод — только после «да» пользователя.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const [env, ...flags] = process.argv.slice(2);
const flag = (n) => { const i = flags.indexOf(n); return i < 0 ? undefined : flags[i + 1]; };
if (require.main === module && !['local', 'prod'].includes(env)) { console.error('usage: <local|prod> [--with-zero] [--sheets f] [--pipes f] [--apply --out откат.json]'); process.exit(2); }
const APPLY = flags.includes('--apply');
const WITH_ZERO = flags.includes('--with-zero');
const OUT = flag('--out');
if (require.main === module && APPLY && (!OUT || OUT.startsWith('--'))) { console.error('--apply требует --out откат.json'); process.exit(2); }
const BASE = env === 'prod' ? 'https://kppdf-crm.ru/db' : 'http://localhost:3001';
const DIR = path.join(__dirname, '../../для анализа');
const API_SH = path.join(__dirname, '../../deploy/synology/api.sh').split(path.sep).join('/');
const AS_OF = '10.10.2026';
const CLIENT_UID = 'metal-import-2026-10-10';
const CAT = { sheet: 'Лист металлический', rect: 'Труба профильная', round: 'Труба круглая' };
const GRADE = { 'st 3': 'Ст3', 'asi 304': 'AISI 304', 'asi 430': 'AISI 430', amg2: 'АМг2', zn: 'Оцинкованная сталь' };

const num = (v) => { const n = Number(String(v ?? '').replace(',', '.').trim()); return Number.isFinite(n) ? n : 0; };
const ru = (n) => String(n).replace('.', ',');
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const cells = (line) => line.replace(/\r$/, '').split(',').map((c) => c.trim());
const lines = (text) => text.replace(/^﻿/, '').split('\n');

/** Лист: «марка, толщина, габарит, количество, примечания» → строки плана. */
function parseSheets(text) {
  const out = [];
  for (const [i, line] of lines(text).entries()) {
    if (i === 0) continue;
    const [rawGrade, t, format, qty, note = ''] = cells(line);
    const thickness = num(t);
    if (!rawGrade || rawGrade === '-' || !thickness) continue;
    const ribbed = /рефл/i.test(rawGrade) || /рефл/i.test(note);
    const grade = GRADE[norm(rawGrade.replace(/рефл/i, ''))];
    if (!grade) throw new Error(`лист, строка ${i + 1}: неизвестная марка «${rawGrade}»`);
    const [w, l] = format ? format.split(/[xх×]/i).map(Number) : [];
    const kind = ribbed ? 'Лист рифлёный' : 'Лист';
    const size = format ? ` ${w}×${l}` : '';
    const rest = /рефл/i.test(note) ? '' : note;
    const off = rest.match(/(\d{3,4})\s*[xх×]\s*(\d{3,4})/i);
    out.push({
      src: `лист:${i + 1}`, cat: CAT.sheet, unit: 'лист', qty: num(qty), name: `${kind} ${grade} ${ru(thickness)} мм${size}`,
      assortment: `${kind} ${ru(thickness)} мм`, materialGrade: grade, dims: { thickness, ...(format ? { width: w, length: l } : {}) },
      note: rest, check: rest ? `${rest}` : '', ...(off ? { offcut: { lengthMm: +off[1], widthMm: +off[2] } } : {}),
    });
  }
  return out;
}

/** Сечение из таблицы → размеры. «d33.5x3(ВГП 25)», «60х40х3», «40x20» (без стенки). */
function parseSection(raw) {
  const s = raw.trim();
  const vgp = s.match(/\((ВГП[^)]*)\)/i)?.[1];
  const p = s.replace(/\(.*\)/, '').replace(/^d/i, '').split(/[xх×]/i).map(num);
  if (/^d/i.test(s)) return { round: true, diameter: p[0], wall: p[1], label: `Ø${ru(p[0])}×${ru(p[1])}${vgp ? ` (${vgp})` : ''}` };
  return { round: false, a: p[0], b: p[1], wall: p[2], label: p.map(ru).join('×') };
}

const pipeRow = (src, section, grade, suffix, metres, length, note) => {
  const x = parseSection(section);
  const base = `Труба ${grade ? 'нерж. ' : ''}${x.label}`;
  return {
    src, cat: x.round ? CAT.round : CAT.rect, unit: 'м', qty: metres, name: `${base}${suffix ? ' ' + suffix : ''}`, assortment: `Труба ${x.label}`,
    materialGrade: grade || undefined, dims: { ...(x.wall ? { thickness: x.wall } : {}), ...(x.diameter ? { diameter: x.diameter } : {}), ...(length ? { length } : {}) }, note, check: '',
  };
};

/** Труба: чёрная (мытая / не мытая × 6 / 12 м) до строки «НЕРЖА», затем нержавеющая по столбцу «Итого». */
function parsePipes(text) {
  const out = []; const warn = [];
  let steel = false;
  for (const [i, line] of lines(text).entries()) {
    const c = cells(line);
    const src = `труба:${i + 1}`;
    if (i === 0) continue;
    if (/^НЕРЖА/i.test(c[0])) { steel = true; continue; }
    if (!c[0] || c[1] === '2 метра(шт)') continue;
    if (!/\d/.test(c[0])) continue;
    if (steel) {
      const [m2, m4, m6, m3] = [c[1], c[2], c[3], c[4]].map(num);
      const total = num(c[5]), bits = num(c[6]);
      const whole = m2 * 2 + m4 * 4 + m6 * 6 + m3 * 3;
      if (total < whole || total > whole + bits * 2) warn.push(`${src} ${c[0]}: Итого ${total} м, по штукам ${whole} м + кусков ${bits}`);
      const note = [m2 && `${m2} шт по 2 м`, m4 && `${m4} шт по 4 м`, m6 && `${m6} шт по 6 м`, m3 && `${m3} шт по 3 м`, bits && `кусков более 1 м: ${bits}`].filter(Boolean).join(', ');
      out.push(pipeRow(src, c[0], 'Нержавеющая сталь', '', total, 0, note));
      continue;
    }
    const [w6, w12, r6, r12] = [c[1], c[2], c[3], c[4]].map(num);
    const washed = w6 * 6 + w12 * 12, raw = r6 * 6 + r12 * 12, total = num(c[5]);
    if (washed + raw !== total) warn.push(`${src} ${c[0]}: Итого ${total} м, по штукам ${washed + raw} м`);
    const note = (a, b) => [a && `${a} шт по 6 м`, b && `${b} шт по 12 м`].filter(Boolean).join(', ');
    const len = (a, b) => (b && !a ? 12000 : 6000);
    if (washed) out.push(pipeRow(src, c[0], '', 'мытая', washed, len(w6, w12), note(w6, w12)));
    if (raw || !washed) out.push(pipeRow(src, c[0], '', 'не мытая', raw, len(r6, r12), note(r6, r12)));
  }
  return { rows: out, warn };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// вход и пароль — только внутри deploy/synology/api.sh (правило проекта); ответ с ошибкой — { statusCode, message }
async function api(method, p, body) {
  const file = body ? path.join(os.tmpdir(), `metal-import-${process.pid}.json`).split(path.sep).join('/') : '';
  if (body) fs.writeFileSync(file, JSON.stringify(body));
  for (let i = 0; ; i++) {
    await sleep(700); // лимит 100/мин
    const txt = execFileSync('bash', [API_SH, env, method, p, ...(file ? [file] : [])], { encoding: 'utf8', maxBuffer: 1 << 28 });
    let j; try { j = JSON.parse(txt); } catch { throw new Error(`${method} ${p} → ${txt.slice(0, 200)}`); }
    if (j?.statusCode === 429 && i < 5) { await sleep(15000); continue; }
    if (j?.statusCode >= 400) throw new Error(`${method} ${p} → ${j.statusCode} ${j.message}`);
    return j;
  }
}
async function all(p) {
  const out = [];
  for (let page = 1; ; page++) {
    const j = await api('GET', `${p}${p.includes('?') ? '&' : '?'}page=${page}&limit=100`);
    out.push(...(j.items || []));
    if (out.length >= (j.total ?? 0) || !(j.items || []).length) return out;
  }
}

/** Что делать с разобранными строками: новые — создать, с нулём — пропустить, уже есть — не трогать. */
function plan(rows, existingNames, withZero) {
  const seen = new Set(); const create = [], zero = [], exists = [], dup = [];
  for (const r of rows) {
    const k = norm(r.name);
    if (seen.has(k)) { dup.push(r); continue; }
    seen.add(k);
    if (existingNames.has(k)) exists.push(r);
    else if (!r.qty && !withZero) zero.push(r);
    else create.push(r);
  }
  return { create, zero, exists, dup };
}

async function main() {
  const sheets = parseSheets(fs.readFileSync(flag('--sheets') || path.join(DIR, 'Лист - Лист2.csv'), 'utf8'));
  const { rows: pipes, warn } = parsePipes(fs.readFileSync(flag('--pipes') || path.join(DIR, 'Учет трубы - Лист1.csv'), 'utf8'));
  const items = await all('/api/stock/items');
  const p = plan([...sheets, ...pipes], new Set(items.map((m) => norm(m.name))), WITH_ZERO);
  console.log(`${BASE}${APPLY ? '' : ' (план)'}: на складе позиций ${items.length}`);
  for (const [cat] of [[CAT.sheet], [CAT.rect], [CAT.round]]) {
    const list = p.create.filter((r) => r.cat === cat);
    console.log(`\n${cat}: создать ${list.length}, всего ${ru(Math.round(list.reduce((s, r) => s + r.qty, 0) * 1000) / 1000)} ${list[0]?.unit || ''}`);
    for (const r of list) console.log(`  ${r.name} — ${ru(r.qty)} ${r.unit}${r.note ? `  (${r.note})` : ''}`);
  }
  console.log(`\nПропущено с нулём: ${p.zero.length}. Уже есть: ${p.exists.length}. Повторы в таблице: ${p.dup.length}.`);
  const check = p.create.filter((r) => r.check);
  if (check.length) { console.log('\nУточнить у кладовщика (остатки без размера посчитаны как примечание):'); for (const r of check) console.log(`  ${r.name}: ${r.qty} ${r.unit}, в таблице «${r.check}»`); }
  if (warn.length) { console.log('\nНе сходится «Итого»:'); for (const w of warn) console.log('  ' + w); }
  if (!APPLY) { console.log('\nНичего не записано (план). Записать: --apply --out откат.json'); return; }

  const done = { createdIds: [], batchId: null, offcuts: [] };
  const save = () => fs.writeFileSync(OUT, JSON.stringify(done, null, 2));
  const lines_ = [];
  for (const r of p.create) {
    const item = await api('POST', '/api/stock/items', { name: r.name, unit: r.unit, categoryName: r.cat, assortment: r.assortment, materialGrade: r.materialGrade, dims: r.dims, notes: r.note ? `Таблица учёта на ${AS_OF}: ${r.note}` : undefined });
    done.createdIds.push(item.id); save();
    r.id = item.id;
    if (r.qty) lines_.push({ materialId: item.id, qty: r.qty, ...(r.note ? { note: r.note.slice(0, 500) } : {}) });
  }
  for (let i = 0; i < lines_.length; i += 500) {
    const b = await api('POST', '/api/stock/batch', { type: 'in', lines: lines_.slice(i, i + 500), note: `Начальный остаток на ${AS_OF} (таблицы учёта металла)`, clientUid: `${CLIENT_UID}-${i}` });
    done.batchId = done.batchId || b.batchId; save();
  }
  for (const r of p.create.filter((x) => x.offcut)) {
    await api('POST', `/api/stock/items/${r.id}/offcut`, { ...r.offcut, note: `Таблица учёта на ${AS_OF}` });
    done.offcuts.push(r.name); save();
  }
  console.log(`\nСоздано позиций: ${done.createdIds.length}, строк прихода: ${lines_.length}, обрезков: ${done.offcuts.length}. Пачка: ${done.batchId}. Откат: ${OUT}`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { parseSheets, parsePipes, parseSection, plan };
