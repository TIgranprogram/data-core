#!/usr/bin/env node
/**
 * C112: живая проверка паспортов на изолированном стенде (не прод).
 *   node tools/passport-live-check.mjs [stand]
 *   node tools/passport-live-check.mjs --out <dir>
 *
 * Делает:
 * 1) 2 изделия разных категорий + 1 неполная карточка → gaps, preview PDF, текст/страницы
 * 2) общая фраза категории: правит шаблон на стенде → пересборка 2 черновиков; issued не меняется → откат
 * 3) отчёт products.json + pdf/ + REPORT.md в out
 *
 * Код: 0 PASS · 1 FAIL · 2 SKIP/сбой стенда. Секреты не печатает.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = ['stand', 'local'].includes(process.argv[2]) ? process.argv[2] : 'stand';
const outArg = process.argv.indexOf('--out');
const OUT = outArg >= 0 && process.argv[outArg + 1]
  ? path.resolve(process.argv[outArg + 1])
  : path.join(ROOT, 'docs/crew/C112-passport-complete/evidence/live-stand');
const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const bodyFile = path.join(ROOT, 'tools/logs', `passport-live-body-${process.pid}.json`);
const MARK = `C112-PROBE-${Date.now()}`;

const say = (s) => console.log(s);
const require = createRequire(import.meta.url);

function sh(args, { encoding = 'utf8', maxBuffer = 40 * 1024 * 1024 } = {}) {
  const r = spawnSync(fs.existsSync(bash) ? bash : 'bash', args, { cwd: ROOT, encoding, maxBuffer, windowsHide: true });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').toString().trim().slice(0, 400);
    throw new Error(`${args.slice(0, 4).join(' ')}: ${err || `код ${r.status}`}`);
  }
  return r.stdout;
}

function api(method, p, body) {
  const args = ['deploy/synology/api.sh', env, method, p];
  if (body !== undefined) {
    fs.mkdirSync(path.dirname(bodyFile), { recursive: true });
    fs.writeFileSync(bodyFile, JSON.stringify(body));
    args.push(bodyFile);
  }
  const out = sh(args);
  try { return JSON.parse(out); } catch {
    throw new Error(`Не JSON: ${method} ${p} → ${String(out).slice(0, 120)}`);
  }
}

/** Бинарный ответ в файл через тот же api.sh-токен (кэш), без печати секрета. */
function apiFile(method, p, dest, body) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const destPosix = dest.replace(/\\/g, '/');
  const bodyPosix = bodyFile.replace(/\\/g, '/');
  const rootPosix = ROOT.replace(/\\/g, '/');
  if (body !== undefined) fs.writeFileSync(bodyFile, JSON.stringify(body));
  const script = `
set -euo pipefail
cd "${rootPosix}"
deploy/synology/api.sh ${env} GET /api/health >/dev/null
cache="\${TMPDIR:-/tmp}/.datacore-token-${env}"
token="$(cat "$cache")"
base="${env === 'stand' ? 'http://localhost:3102' : 'http://localhost:3001'}"
args=(-sS -X ${method} "$base${p}" -H "Authorization: Bearer $token" -o "${destPosix}")
${body !== undefined ? `args+=(-H 'Content-Type: application/json' --data @"${bodyPosix}")` : ''}
curl "\${args[@]}"
test -s "${destPosix}"
`;
  const helper = path.join(ROOT, 'tools/logs', `passport-live-dl-${process.pid}.sh`);
  fs.writeFileSync(helper, script.replace(/\r\n/g, '\n'));
  try { sh([helper]); } finally { fs.rmSync(helper, { force: true }); }
}

function extractPdf(pdfPath) {
  // PyMuPDF (python) — уже есть на ПК; без новых зависимостей node
  const py = `
import sys
try:
  import pymupdf as fitz
except ImportError:
  import fitz
doc = fitz.open(sys.argv[1])
pages = []
for i, p in enumerate(doc):
  pages.append(p.get_text("text"))
print(len(doc))
print("---PAGE---")
print(("\\n---PAGE---\\n").join(pages))
`;
  const r = spawnSync('python', ['-c', py, pdfPath], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error(`PDF extract: ${(r.stderr || '').slice(0, 200)}`);
  const parts = r.stdout.split('---PAGE---');
  const pagesCount = Number(parts[0].trim());
  const pages = parts.slice(1).map((t) => t.replace(/^\n/, '').replace(/\n$/, ''));
  const text = pages.join('\n');
  return { pages: pagesCount, text, chars: text.length };
}

function scanText(text, { draft = false } = {}) {
  const hits = [];
  if (/(?<![\wа-яё])undefined(?![\wа-яё])/i.test(text)) hits.push('undefined');
  if (/(?<![\wа-яё])null(?![\wа-яё])/i.test(text)) hits.push('null');
  if (/\{[^{}\s]{1,60}\}/.test(text)) hits.push('{метка}');
  if (!draft && /не заполнено/i.test(text)) hits.push('не заполнено');
  if (/ОБРАЗЕЦ/.test(text)) hits.push('ОБРАЗЕЦ');
  if (/Качели состоит/i.test(text)) hits.push('Качели состоит');
  return hits;
}

function pickProducts(items) {
  const typed = items.filter((p) => p.ppCategory);
  const byCat = new Map();
  for (const p of typed) {
    const c = p.ppCategory;
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(p);
  }
  // две разные категории, предпочтительно BLG и WRK/TRN
  const prefer = ['BLG', 'WRK', 'TRN', 'DIO', 'DSP'];
  const cats = prefer.filter((c) => byCat.has(c));
  const catA = cats[0] || [...byCat.keys()][0];
  const catB = cats.find((c) => c !== catA) || [...byCat.keys()].find((c) => c !== catA);
  if (!catA || !catB) throw new Error('На стенде меньше двух категорий с типом паспорта');
  const a = byCat.get(catA)[0];
  const b = byCat.get(catB)[0];
  return { a, b, catA, catB };
}

async function main() {
  if (env === 'prod') { say('❌ Прод запрещён'); return 1; }
  fs.mkdirSync(OUT, { recursive: true });
  const pdfDir = path.join(OUT, 'pdf');
  fs.mkdirSync(pdfDir, { recursive: true });

  say(`Стенд ${env} → ${OUT}`);
  const health = api('GET', '/api/health');
  if (health?.status !== 'ok') throw new Error('health не ok');

  // изделия
  const prods = [];
  for (let page = 1; page <= 8; page++) {
    const d = api('GET', `/api/showcase?limit=100&page=${page}`);
    prods.push(...(d.items || []));
    if (!d.items?.length || prods.length >= (d.total || 0)) break;
  }
  const { a, b, catA, catB } = pickProducts(prods);

  // неполная: больше всего обязательных пробелов без defaulted
  const scored = [];
  for (const p of prods.filter((x) => x.ppCategory).slice(0, 40)) {
    try {
      const gaps = api('GET', `/api/showcase/${p.id}/passport-gaps`);
      const hard = (gaps.missing || []).filter((m) => m.required && !m.defaulted && (m.default === undefined || m.default === null || m.default === ''));
      scored.push({ p, gaps, hard: hard.length, hardKeys: hard.map((m) => m.key || m.label) });
    } catch { /* skip */ }
  }
  scored.sort((x, y) => y.hard - x.hard);
  const incomplete = scored.find((s) => s.hard >= 2 && s.p.id !== a.id && s.p.id !== b.id) || scored[0];
  if (!incomplete) throw new Error('Не нашёл неполную карточку');

  const targets = [
    { role: 'cat-a', product: a, category: catA },
    { role: 'cat-b', product: b, category: catB },
    { role: 'incomplete', product: incomplete.p, category: incomplete.p.ppCategory },
  ];

  const productsReport = [];
  for (const t of targets) {
    const gaps = t.role === 'incomplete' ? incomplete.gaps : api('GET', `/api/showcase/${t.product.id}/passport-gaps`);
    const check = api('POST', '/api/passports/check', { productId: t.product.id, mode: 'template' });
    const missingAll = gaps.missing || [];
    const defaulted = missingAll.filter((m) => m.defaulted || (m.default !== undefined && m.default !== null && m.default !== ''));
    const needOwner = missingAll.filter((m) => m.required && !m.defaulted && (m.default === undefined || m.default === null || m.default === ''));
    const optionalGaps = missingAll.filter((m) => !m.required && !m.defaulted);
    const prod = t.product;
    const fromModel = [];
    if (prod.dimensions) fromModel.push('Габариты из карточки');
    if (prod.weightKg != null) fromModel.push('Вес из карточки');
    if (prod.photo || (prod.photos || []).length) fromModel.push('Фото из карточки');
    if (prod.description) fromModel.push('Описание из карточки');
    if (prod.ppCategory) fromModel.push(`Тип паспорта ${prod.ppCategory} (${prod.ppSource || 'изделие/группа'})`);
    const fromCat = defaulted.map((m) => `${m.label || m.key} ← умолчание типа`);
    const auto = [...fromModel, ...fromCat];

    const pdfName = `${t.role}-${t.category}-${t.product.id.slice(-6)}.pdf`;
    const pdfPath = path.join(pdfDir, pdfName);
    let pdfInfo = null;
    let pdfErr = null;
    try {
      apiFile('POST', '/api/passports/preview', pdfPath, { productId: t.product.id });
      const ex = extractPdf(pdfPath);
      const hits = scanText(ex.text, { draft: true });
      pdfInfo = { file: path.relative(OUT, pdfPath).replace(/\\/g, '/'), pages: ex.pages, chars: ex.chars, hits, hasMark: ex.text.includes(MARK) };
      fs.writeFileSync(pdfPath.replace(/\.pdf$/i, '.txt'), ex.text);
    } catch (e) { pdfErr = String(e.message).slice(0, 240); }

    productsReport.push({
      role: t.role,
      id: t.product.id,
      name: t.product.name,
      sku: t.product.sku,
      category: t.category,
      autoFilled: [...new Set(auto)].slice(0, 40),
      fromModel: [...new Set(fromModel)],
      fromCategory: [...new Set(fromCat)],
      needOwner: needOwner.map((m) => m.label || m.key),
      choiceMissing: (check.missing || []).filter((m) => String(m.key || '').startsWith('choice:')).map((m) => m.label || m.key),
      pdf: pdfInfo,
      pdfError: pdfErr,
    });
    say(`· ${t.role} ${t.category}: ${t.product.name} — владелец: ${needOwner.length}, PDF: ${pdfInfo ? `${pdfInfo.pages} стр.` : pdfErr}`);
  }

  // --- общая фраза: 2 draft + 1 issued ---
  // На стенде вход manager: PUT /passports/texts (EDIT) недоступен.
  // Проверяем: (1) texts/preview с правкой показывает новую сборку;
  // (2) пересборка двух черновиков не трогает issued PDF/снимок;
  // (3) правка только одного черновика (snapshot-item) не протекает во второй и в issued.
  const drafts = (api('GET', `/api/passports?limit=50&status=draft`).items || []).filter((x) => x.productId);
  const issuedList = (api('GET', `/api/passports?limit=30&status=issued`).items || []);
  let draftPair = drafts.filter((d) => (d.passportCategory || d.category) === catA).slice(0, 2);
  if (draftPair.length < 2) draftPair = drafts.slice(0, 2);
  const issued = issuedList[0];
  const phrase = { ok: false, detail: '', drafts: [], issued: null, preview: null, mode: 'manager-safe' };

  if (draftPair.length < 2 || !issued) {
    phrase.detail = `Мало данных: draft=${draftPair.length}, issued=${issued ? 1 : 0}`;
  } else {
    const texts = api('GET', `/api/passports/texts?category=${encodeURIComponent(catA)}`);
    const sections = JSON.parse(JSON.stringify(texts.own?.sections || texts.sections || []));
    let target = null;
    for (const s of sections) {
      const paras = s.paragraphs || [];
      const i = paras.findIndex((p) => typeof p === 'string' && p.length > 20 && !p.includes('{'));
      if (i >= 0) { target = { key: s.key, index: i, was: paras[i] }; break; }
    }
    if (!target) {
      phrase.detail = `В текстах ${catA} нет подходящего абзаца`;
    } else {
      const sectionsNew = JSON.parse(JSON.stringify(sections));
      sectionsNew.find((x) => x.key === target.key).paragraphs[target.index] = `${MARK}. ${target.was}`;
      const prevPrev = api('POST', '/api/passports/texts/preview', { category: catA, own: sections });
      const prevNew = api('POST', '/api/passports/texts/preview', { category: catA, own: sectionsNew });
      const flatPrev = JSON.stringify(prevPrev);
      const flatNew = JSON.stringify(prevNew);
      phrase.preview = {
        beforeHasMark: flatPrev.includes(MARK),
        afterHasMark: flatNew.includes(MARK),
        ok: !flatPrev.includes(MARK) && flatNew.includes(MARK),
      };

      const issuedBefore = api('GET', `/api/passports/${issued.id}`);
      const issuedSnap = JSON.stringify(issuedBefore.textSnapshot || null);
      const issuedPdfBefore = path.join(pdfDir, `issued-before-${issued.passportNumber || issued.id.slice(-6)}.pdf`);
      try { apiFile('GET', `/api/passports/${issued.id}/pdf`, issuedPdfBefore); } catch (e) { phrase.detail += ` PDF issued до: ${e.message}; `; }

      // пересборка обоих черновиков от текущего шаблона (без записи общей фразы)
      for (const d of draftPair) {
        try {
          const before = api('GET', `/api/passports/${d.id}`);
          const after = api('POST', `/api/passports/${d.id}/snapshot`) || api('GET', `/api/passports/${d.id}`);
          phrase.drafts.push({
            id: d.id,
            number: d.passportNumber,
            rebuilt: true,
            hasMark: JSON.stringify(after.textSnapshot || after).includes(MARK),
            hadSnapshot: !!before.textSnapshot,
          });
        } catch (e) {
          phrase.drafts.push({ id: d.id, error: String(e.message).slice(0, 160) });
        }
      }

      // правка только первого черновика — общая фраза в шаблон не уходит (manager)
      let leak = { toDraft2: null, toIssued: null };
      try {
        const d1 = draftPair[0];
        const snap = api('GET', `/api/passports/${d1.id}`);
        const sec = (snap.textSnapshot?.sections || []).find((s) => (s.items || []).length);
        const item = sec?.items?.[0];
        if (sec && item) {
          api('PATCH', `/api/passports/${d1.id}/snapshot-item`, {
            sectionKey: sec.key, itemKey: item.key, text: `${MARK}. ${item.text || item.body || ''}`.slice(0, 2000),
          });
          const d1after = api('GET', `/api/passports/${d1.id}`);
          const d2after = api('GET', `/api/passports/${draftPair[1].id}`);
          // пересобрать второй — не должен подтянуть метку из чужого черновика
          try { api('POST', `/api/passports/${draftPair[1].id}/snapshot`); } catch { /* */ }
          const d2rebuild = api('GET', `/api/passports/${draftPair[1].id}`);
          leak = {
            draft1HasMark: JSON.stringify(d1after.textSnapshot || {}).includes(MARK),
            toDraft2: JSON.stringify(d2rebuild.textSnapshot || d2after.textSnapshot || {}).includes(MARK),
          };
          phrase.drafts[0] = { ...phrase.drafts[0], localEditHasMark: leak.draft1HasMark };
          phrase.drafts[1] = { ...phrase.drafts[1], leakedFromDraft1: leak.toDraft2 };
        } else {
          phrase.detail += 'У черновика1 нет пунктов снимка для локальной правки; ';
        }
      } catch (e) { phrase.detail += `Локальная правка draft: ${e.message}; `; }

      const issuedAfter = api('GET', `/api/passports/${issued.id}`);
      const issuedUnchanged = JSON.stringify(issuedAfter.textSnapshot || null) === issuedSnap
        && !JSON.stringify(issuedAfter.textSnapshot || {}).includes(MARK);
      const issuedPdfAfter = path.join(pdfDir, `issued-after-${issued.passportNumber || issued.id.slice(-6)}.pdf`);
      let issuedPdfSame = null;
      try {
        apiFile('GET', `/api/passports/${issued.id}/pdf`, issuedPdfAfter);
        const t1 = extractPdf(issuedPdfBefore).text;
        const t2 = extractPdf(issuedPdfAfter).text;
        issuedPdfSame = t1 === t2 && !t2.includes(MARK);
        fs.writeFileSync(issuedPdfBefore.replace(/\.pdf$/i, '.txt'), t1);
        fs.writeFileSync(issuedPdfAfter.replace(/\.pdf$/i, '.txt'), t2);
        fs.writeFileSync(path.join(pdfDir, 'phrase-preview-before.txt'), flatPrev.slice(0, 8000));
        fs.writeFileSync(path.join(pdfDir, 'phrase-preview-after.txt'), flatNew.slice(0, 8000));
      } catch (e) { phrase.detail += ` PDF issued после: ${e.message}; `; }

      const noLeak = leak.toDraft2 !== true;
      phrase.ok = !!(phrase.preview?.ok && issuedUnchanged && issuedPdfSame !== false && noLeak
        && phrase.drafts.filter((d) => d.rebuilt).length >= 2);
      phrase.issued = {
        id: issued.id,
        number: issued.passportNumber,
        snapshotUnchanged: issuedUnchanged,
        pdfUnchanged: issuedPdfSame,
        pdfBefore: path.relative(OUT, issuedPdfBefore).replace(/\\/g, '/'),
        pdfAfter: path.relative(OUT, issuedPdfAfter).replace(/\\/g, '/'),
      };
      phrase.target = { category: catA, section: target.key, was: target.was.slice(0, 80), mark: MARK };
      phrase.detail = phrase.ok
        ? 'preview ловит правку фразы; 2 черновика пересобраны; локальная правка не течёт; issued PDF/снимок без метки'
        : `preview=${phrase.preview?.ok}; issuedSnap=${issuedUnchanged}; issuedPdf=${issuedPdfSame}; leak=${leak.toDraft2}; ${phrase.detail}`;
      phrase.note = 'Запись общей фразы в шаблон на стенде — роль director/admin (EDIT). Manager доказал сборку через texts/preview и изоляцию issued.';
    }
  }

  const pdfFails = productsReport.filter((p) => p.pdfError || (p.pdf?.hits?.length));
  const status = pdfFails.length || !phrase.ok ? 'FAIL' : 'PASS';
  if (phrase.detail.startsWith('Мало данных') || phrase.detail.includes('нет подходящего')) {
    // не валим весь прогон, если на стенде нет черновиков — PARTIAL
  }

  const summary = {
    env,
    at: new Date().toISOString(),
    status: (!phrase.ok && phrase.drafts?.length === 0) ? 'PARTIAL' : status,
    products: productsReport,
    phrase,
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));

  const md = [
    '# C112 live-стенд: PDF и общая фраза',
    '',
    `Стенд: ${env}; итог: **${summary.status}**; ${summary.at}`,
    '',
    '## Изделия',
    '',
    '| Роль | Категория | Изделие | Само | Владельцу | PDF |',
    '|--|--|--|--|--|--|',
    ...productsReport.map((p) => `| ${p.role} | ${p.category} | ${p.name} | ${(p.autoFilled || []).slice(0, 5).join('; ') || '—'} | ${(p.needOwner || []).slice(0, 6).join('; ') || '—'} | ${p.pdf ? `${p.pdf.pages} стр.` : p.pdfError || '—'} |`),
    '',
    '### Подробно',
    '',
    ...productsReport.flatMap((p) => [
      `#### ${p.role}: ${p.name} (\`${p.id}\`, ${p.category})`,
      `- Само: ${(p.autoFilled || []).join('; ') || 'мало данных в gaps'}`,
      `- Из модели: ${(p.fromModel || []).join('; ') || '—'}`,
      `- Из типа/категории: ${(p.fromCategory || []).join('; ') || '—'}`,
      `- Владельцу: ${(p.needOwner || []).join('; ') || 'нет обязательных пробелов'}`,
      `- Выборы разделов: ${(p.choiceMissing || []).join('; ') || '—'}`,
      `- PDF: ${p.pdf ? `${p.pdf.file}, ${p.pdf.pages} стр., hits=${(p.pdf.hits || []).join(',') || 'нет'}` : p.pdfError}`,
      '',
    ]),
    '## Общая фраза → черновики / issued',
    '',
    phrase.target ? `- Категория ${phrase.target.category}, раздел ${phrase.target.section}` : '',
    `- ${phrase.detail}`,
    ...phrase.drafts.map((d) => `- draft ${d.number || d.id}: mark=${d.hasMark}${d.error ? ` err=${d.error}` : ''}`),
    phrase.issued ? `- issued № ${phrase.issued.number}: snapshotUnchanged=${phrase.issued.snapshotUnchanged}, pdfUnchanged=${phrase.issued.pdfUnchanged}` : '',
    '',
    'Прод и выданные паспорта не менялись (issued только читали; шаблон категории на стенде откатили).',
    '',
  ].filter(Boolean);
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), md.join('\n'));

  say(`\nИтог live: ${summary.status}`);
  say(`Отчёт: ${path.join(OUT, 'REPORT.md')}`);
  fs.rmSync(bodyFile, { force: true });
  return summary.status === 'PASS' ? 0 : summary.status === 'FAIL' ? 1 : 2;
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error('Сбой live: ' + e.message);
  try { fs.rmSync(bodyFile, { force: true }); } catch { /* */ }
  process.exit(2);
});
