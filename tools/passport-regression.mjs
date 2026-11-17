#!/usr/bin/env node
/**
 * C112: одна кнопка — автоматическая регрессия паспортов (без ИИ и без прода).
 *   node tools/passport-regression.mjs           полный прогон
 *   node tools/passport-regression.mjs --last    итог прошлого запуска
 * Код выхода: 0 PASS · 1 FAIL · 2 PARTIAL (есть SKIP)
 *
 * Авто: юнит паспортных модулей, синтаксис PWA-описания, скан извлечённых PDF-текстов.
 * ИИ-вычитка — отдельная кнопка пульта (ai-tester --tasks pass-*).
 * E2E с БД — только если подтверждена изоляция (DC_PASSPORT_E2E=1).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGS = path.join(ROOT, 'tools/logs/passport-regression');
const BE = path.join(ROOT, 'backend');

/** Жёсткие дефекты сборки/печати — FAIL. */
const BAD = [
  { id: 'undefined', re: /(?<![\wа-яё])undefined(?![\wа-яё])/i, why: 'служебное undefined в тексте PDF' },
  { id: 'null', re: /(?<![\wа-яё])null(?![\wа-яё])/i, why: 'служебное null в тексте PDF' },
  { id: 'brace', re: /\{[^{}\s]{1,60}\}/, why: 'неподставленная метка {…}' },
  { id: 'not-filled', re: /не заполнено/i, why: 'метка «не заполнено» в выпущенном тексте' },
  { id: 'sample', re: /ОБРАЗЕЦ/, why: 'служебная пометка ОБРАЗЕЦ' },
  { id: 'swing-agree', re: /Качели состоит/i, why: 'несогласованное «Качели состоит»' },
];
/** Подсказки по данным или устаревшим снимкам — не валят автопрогон. */
const HINTS = [
  { id: 'old-gender', re: /\(в дальнейшем именуемое «Изделие»\),\s*изготовленн|изделие\)\s+изготовлен\s+из/i, why: 'устаревшее описание (род названия); новые черновики собирают «Изделие изготовлено из»' },
  { id: 'stella-name', re: /\bСтелла\b/, why: 'название «Стелла» — проверить карточку (ожидается «Стела»)' },
  { id: 'art-object', re: /Арт объект/, why: '«Арт объект» без дефиса — карточка изделия' },
];

const say = (s) => console.log(s);
const totalStatus = (rows) => (rows.some((r) => r.status === 'FAIL') ? 'FAIL' : rows.some((r) => r.status === 'SKIP') ? 'PARTIAL' : 'PASS');

function run(command, args, { cwd = ROOT, timeoutMs = 600000 } = {}) {
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let error = false;
    let finished = false;
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const append = (d) => { output = (output + d.toString()).slice(-2 * 1024 * 1024); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const done = (code) => { if (finished) return; finished = true; clearTimeout(timer); resolve({ code, output, timedOut, error }); };
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else try { child.kill('SIGKILL'); } catch { /* */ }
    }, timeoutMs);
    child.on('error', () => { error = true; done(null); });
    child.on('close', done);
  });
}

function scanPdfTexts(dir) {
  if (!fs.existsSync(dir)) return { status: 'SKIP', detail: `Нет папки ${path.relative(ROOT, dir)}`, hits: [] };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt'));
  if (!files.length) return { status: 'SKIP', detail: 'Нет извлечённых .txt', hits: [] };
  const hits = [];
  const dataHints = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const rule of BAD) {
      if (rule.re.test(text)) hits.push({ file: f, id: rule.id, why: rule.why });
    }
    for (const rule of HINTS) {
      if (!rule.re.test(text)) continue;
      if (rule.id === 'stella-name' && /стеллаж/i.test(text.replace(/\bСтелла\b/g, '·'))) continue;
      dataHints.push({ file: f, id: rule.id, why: rule.why });
    }
  }
  return {
    status: hits.length ? 'FAIL' : 'PASS',
    detail: hits.length
      ? `Находок сборки: ${hits.length}` + (dataHints.length ? `; подсказки по данным: ${dataHints.length}` : '')
      : `Чисто по ${files.length} файлам` + (dataHints.length ? `; подсказки по данным: ${dataHints.length}` : ''),
    hits,
    dataHints,
  };
}

function checkPwaDescription() {
  const file = path.join(ROOT, 'backend/pwa/sections/passports/common.js');
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/export function buildDescription\(v\)\s*\{([\s\S]*?)\n\}/);
  if (!m) return { status: 'FAIL', detail: 'buildDescription не найден в common.js' };
  const body = m[1];
  if (/в дальнейшем именуемое/.test(body)) return { status: 'FAIL', detail: 'PWA всё ещё собирает старое «в дальнейшем именуемое»' };
  if (!/далее — изделие/.test(body) || !/Изделие изготовлено из/.test(body)) {
    return { status: 'FAIL', detail: 'PWA buildDescription не совпадает с сервером (далее — изделие / Изделие изготовлено из)' };
  }
  return { status: 'PASS', detail: 'PWA buildDescription совпадает с правилом сервера' };
}

async function main(argv = process.argv.slice(2)) {
  fs.mkdirSync(LOGS, { recursive: true });
  if (argv.includes('--last')) {
    const last = JSON.parse(fs.readFileSync(path.join(LOGS, 'last.json'), 'utf8'));
    const summary = JSON.parse(fs.readFileSync(path.join(last.runDir, 'summary.json'), 'utf8'));
    say(`Последняя проверка паспортов: ${summary.status}\nОтчёт: ${path.join(last.runDir, 'REPORT.md')}`);
    return summary.status === 'PASS' ? 0 : summary.status === 'FAIL' ? 1 : 2;
  }

  const runDir = path.join(LOGS, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
  fs.mkdirSync(runDir);
  const rows = [];
  const startedAt = new Date().toISOString();
  const save = (finished) => {
    const summary = { startedAt, finished, status: finished ? totalStatus(rows) : 'RUNNING', kind: 'auto', rows };
    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
    const md = [
      '# Регрессия паспортов (авто)',
      '',
      `Начало: ${startedAt}; итог: ${summary.status}.`,
      '',
      'Раздел **авто** — юнит, синтаксис описания, скан PDF-текстов. Вычитка ИИ — кнопка «Паспорта: глаза ИИ».',
      '',
      '| Этап | Статус | Подробности |',
      '|--|--|--|',
      ...rows.map((r) => `| ${r.title} | ${r.status} | ${(r.detail || '').replace(/\|/g, '/')} |`),
      '',
    ];
    if (rows.some((r) => r.hits?.length)) {
      md.push('## Находки скана PDF', '', ...rows.flatMap((r) => (r.hits || []).map((h) => `- ${h.file}: ${h.id} — ${h.why}`)), '');
    }
    if (rows.some((r) => r.dataHints?.length)) {
      md.push('## Подсказки по данным (не FAIL сборки)', '', ...rows.flatMap((r) => (r.dataHints || []).map((h) => `- ${h.file}: ${h.id} — ${h.why}`)), '');
    }
    fs.writeFileSync(path.join(runDir, 'REPORT.md'), md.join('\n'));
    if (finished) fs.writeFileSync(path.join(LOGS, 'last.json'), JSON.stringify({ runDir }));
  };

  const jestBin = path.join(BE, 'node_modules/jest/bin/jest.js');
  const hasJest = fs.existsSync(jestBin);

  // 1. Юнит паспортных модулей
  {
    const title = 'Юнит: passport* + chain-materials';
    if (!hasJest) rows.push({ id: 'unit', title, status: 'SKIP', detail: 'Нет backend/node_modules/jest' });
    else {
      say('→ юнит паспортных тестов…');
      const r = await run(process.execPath, [jestBin, '--silent', '--runInBand', '--testPathPattern=passport|chain-materials-to-passport'], { cwd: BE, timeoutMs: 900000 });
      const log = path.join(runDir, 'unit.log');
      fs.writeFileSync(log, r.output);
      const ok = !r.error && !r.timedOut && r.code === 0;
      const tail = r.output.trim().split(/\r?\n/).slice(-3).join(' · ');
      rows.push({ id: 'unit', title, status: ok ? 'PASS' : 'FAIL', detail: ok ? (tail || 'ok') : (r.timedOut ? 'таймаут' : tail || `код ${r.code}`), log: 'unit.log' });
    }
    save(false);
  }

  // 2. PWA описание
  {
    const r = checkPwaDescription();
    rows.push({ id: 'pwa-desc', title: 'PWA: buildDescription', status: r.status, detail: r.detail });
    save(false);
  }

  // 3. Скан извлечённых PDF (доказательства C134) + образцы до/после C112
  {
    const dir = path.join(ROOT, 'docs/crew/C134-passport-book-editor/evidence/pdf-check');
    const r = scanPdfTexts(dir);
    rows.push({ id: 'pdf-scan', title: 'Скан PDF-текстов (evidence C134)', status: r.status, detail: r.detail, hits: r.hits, dataHints: r.dataHints });
    fs.writeFileSync(path.join(runDir, 'pdf-scan.json'), JSON.stringify(r, null, 2));
    const afterPath = path.join(ROOT, 'docs/crew/C112-passport-complete/evidence/pdf-before-after/description-after.txt');
    if (fs.existsSync(afterPath)) {
      const after = fs.readFileSync(afterPath, 'utf8');
      const ok = /далее — изделие\)\./.test(after) && /Изделие изготовлено из/.test(after) && !/изделие\)\s+изготовлен\s+из/.test(after);
      rows.push({ id: 'desc-after', title: 'Образец описания «после»', status: ok ? 'PASS' : 'FAIL', detail: ok ? 'Новая форма описания на месте' : 'Образец after не соответствует правилу' });
    } else {
      rows.push({ id: 'desc-after', title: 'Образец описания «после»', status: 'SKIP', detail: 'Нет evidence/pdf-before-after/description-after.txt' });
    }
    save(false);
  }

  // 4. E2E — только по явному флагу (изоляция БД)
  {
    const title = 'E2E passport* (изолированная БД)';
    if (process.env.DC_PASSPORT_E2E !== '1') {
      rows.push({ id: 'e2e', title, status: 'SKIP', detail: 'Нужен DC_PASSPORT_E2E=1 и Mongo datacore-test; иначе кнопка «Тесты кода: все»' });
    } else if (!hasJest) {
      rows.push({ id: 'e2e', title, status: 'SKIP', detail: 'Нет jest' });
    } else {
      say('→ e2e паспортных тестов…');
      const r = await run(process.execPath, [jestBin, '--config', './test/jest-e2e.json', '--runInBand', '--forceExit', '--testPathPattern=passport|chain-materials-to-passport'], {
        cwd: BE,
        timeoutMs: 1200000,
      });
      fs.writeFileSync(path.join(runDir, 'e2e.log'), r.output);
      const ok = !r.error && !r.timedOut && r.code === 0;
      rows.push({ id: 'e2e', title, status: ok ? 'PASS' : 'FAIL', detail: ok ? 'ok' : (r.timedOut ? 'таймаут' : `код ${r.code}`), log: 'e2e.log' });
    }
    save(false);
  }

  save(true);
  const status = totalStatus(rows);
  say(`\nИтог авто: ${status}`);
  say(`Отчёт: ${path.join(runDir, 'REPORT.md')}`);
  say('ИИ-вычитка: пульт → «Паспорта: глаза ИИ» (отдельно от авто).');
  return status === 'PASS' ? 0 : status === 'FAIL' ? 1 : 2;
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(2); });
