// Старожил: чистые правила исполнителя нарядов и карточек (без файлов и сети — проверяются юнит-тестом).
import crypto from 'crypto';
import path from 'path';

/** Заголовок-свойства Markdown (`---` … `---`): ключ: значение; список — [a, b]. Остальное — тело. */
export function parseFront(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(String(text || ''));
  if (!m) return { meta: {}, body: String(text || '') };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line.trim()); if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    else if (/^\d+$/.test(v)) v = Number(v);
    else if (v === 'true' || v === 'false') v = v === 'true';
    meta[kv[1]] = v;
  }
  return { meta, body: String(text).slice(m[0].length) };
}

/**
 * Следующий наряд: статус ready, по приоритету (меньше — раньше), затем по номеру.
 * Разовый наряд с итогом «готово» больше не берётся; repeat: true — берётся снова, но не раньше чем через `everyHours`.
 */
export function pickNext(jobs, history, now = Date.now()) {
  const runs = (id) => history.filter((h) => h.id === id).sort((a, b) => b.at - a.at);
  const last = (id) => runs(id)[0];
  return jobs
    .filter((j) => j.meta.status === 'ready')
    .filter((j) => !needsFix(j, runs(j.id)))
    .filter((j) => {
      const h = last(j.id); if (!h) return true;
      // разовый закрыт, только если итог «готово» и программа не оценила его «плохо» (иначе — повторить после правки наряда)
      if (!j.meta.repeat) return h.result !== 'готово' || h.quality === 'плохо';
      return now - h.at >= (Number(j.meta.everyHours) || 24) * 3600000;
    })
    .sort((a, b) => (Number(a.meta.priority) || 99) - (Number(b.meta.priority) || 99) || a.id.localeCompare(b.id))[0] || null;
}

/**
 * Оценка итога наряда программой: «плохо» — не вышло, итог пустой или больше трети ссылок «файл:строка» неверны.
 * Так плохие итоги видны без чтения, а наряд с двумя плохими подряд встаёт на правку.
 */
export function judge({ result, report = '', refsTotal = 0, refsBad = 0 }) {
  if (result !== 'готово') return 'плохо';
  if (String(report).trim().length < 200) return 'плохо';
  if (refsTotal > 0 && refsBad / refsTotal > 0.3) return 'плохо';
  return 'хорошо';
}

/** Два плохих итога подряд после последней правки файла наряда → не брать, пока Claude не поправит наряд. */
export function needsFix(job, runsNewestFirst) {
  const after = runsNewestFirst.filter((h) => h.at > (job.mtime || 0));
  return after.length >= 2 && after[0].quality === 'плохо' && after[1].quality === 'плохо';
}

/** Секреты и тяжёлое — модели не показываем ни при каком пути. */
const DENY = /(^|[\\/])(\.env[^\\/]*|config\.env|access\.env|CREDENTIALS[^\\/]*|secrets?|\.data|node_modules|\.git|dist|uploads|backups?)([\\/]|$)|password|token|credential|\.(pem|key|pfx|p12|tgz|gz|zip|png|jpe?g|webp|pdf|xlsx?)$/i;
export function isDenied(rel) { return DENY.test(String(rel).replace(/\\/g, '/')); }

/** Путь от модели → абсолютный внутри корня проекта или null (выход наружу, секрет). */
export function safePath(root, p) {
  const rel = String(p || '.').replace(/^[\\/]+/, '');
  const abs = path.resolve(root, rel);
  const r = path.relative(root, abs);
  if (r.startsWith('..') || path.isAbsolute(r)) return null;
  if (r && isDenied(r)) return null;
  return abs;
}

/**
 * Память модели — 16 тыс. токенов. Всегда целы: правила, наряд и записи модели (`notes`);
 * из ответов инструментов полностью — последние `keep`, старые — одной строкой.
 */
export function trimMessages(msgs, keep = 4) {
  const toolIdx = msgs.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0);
  const old = new Set(toolIdx.slice(0, Math.max(0, toolIdx.length - keep)));
  return msgs.map((m, i) => (old.has(i) && m.content.length > 160 ? { ...m, content: m.content.split('\n')[0].slice(0, 150) + ' …(старый ответ, см. свои записи)' } : m));
}

/** Открытые пункты чек-листа: `- [ ]` и `- [~]` с номером строки. */
export function taskItems(md) {
  return String(md).split(/\r?\n/).map((l, i) => ({ l, line: i + 1 }))
    .filter((x) => /^\s*- \[( |~)\]/.test(x.l))
    .map((x) => ({ line: x.line, state: x.l.includes('[~]') ? 'частично' : 'открыт', text: x.l.replace(/^\s*- \[( |~)\]\s*/, '').replace(/\*\*/g, '').trim() }));
}

/** Что в пункте проверяемо программой: пути и имена в `кавычках`, коды задач (C049-1, АБЗ-3, SPEED-2). */
export function itemTokens(text) {
  const out = []; const seen = new Set();
  const add = (kind, v) => { if (!seen.has(v)) { seen.add(v); out.push({ kind, v }); } };
  for (const [, t] of String(text).matchAll(/`([^`]{3,80})`/g)) {
    if (/^(backend|docs|tools|deploy|pult|SRV-ERP|mcp)\/[\w./-]+$/.test(t)) add('path', t.replace(/\/$/, ''));
    else if (/^[\w./:-]+$/.test(t) && !/^\d+$/.test(t)) add('text', t);
  }
  for (const [, c] of String(text).matchAll(/(?<![\p{L}\d])((?:C\d{3}(?:-\d+)?)|(?:[A-ZА-ЯЁ]{2,6}-\d{1,3}))(?![\p{L}\d])/gu)) add('code', c);
  return out.slice(0, 6);
}

/** Ссылки «файл:строка» в итоге модели: файл есть и строка в его пределах — ссылка верна. */
export function checkRefs(report, lineCount) {
  const refs = [...String(report).matchAll(/([\p{L}\d_./-]+\.(?:m?[jt]s|md|json|css|html|sh)):(\d+)/gu)].map((m) => ({ file: m[1], line: Number(m[2]) }));
  const bad = refs.filter((r) => { const n = lineCount(r.file); return n == null || r.line < 1 || r.line > n; });
  return { total: refs.length, bad };
}

/** Маршруты контроллера Nest: префикс @Controller('x') + @Get('y') → { method, path: 'x/y', line }. */
export function moduleRoutes(src) {
  const lines = String(src).split(/\r?\n/); const out = []; let base = '';
  lines.forEach((l, i) => {
    const c = /@Controller\(\s*(?:'([^']*)'|\{[^}]*path:\s*'([^']*)')?/.exec(l); if (c) base = c[1] ?? c[2] ?? '';
    const m = /@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?\s*\)/.exec(l);
    if (m) out.push({ method: m[1].toUpperCase(), path: [base, m[2] || ''].filter(Boolean).join('/'), line: i + 1 });
  });
  return out;
}

/** Отпечаток источников карточки: содержимое файлов по порядку. Нет файла — null. */
export function sourcesHash(contents) {
  if (contents.some((c) => c == null)) return null;
  const h = crypto.createHash('sha1');
  for (const c of contents) h.update(String(c).replace(/\r\n/g, '\n')).update('\0');
  return h.digest('hex').slice(0, 12);
}

/** Состояние карточки: ok · stale (источник изменился) · broken (нет источника или отпечатка). */
export function cardState(meta, hashNow) {
  const src = [].concat(meta.sources || []);
  if (!src.length) return { state: 'broken', why: 'нет sources' };
  if (hashNow == null) return { state: 'broken', why: 'источник не найден' };
  if (!meta.hash) return { state: 'stale', why: 'нет отпечатка — карточка не принята' };
  return meta.hash === hashNow ? { state: 'ok' } : { state: 'stale', why: 'источник изменился' };
}
