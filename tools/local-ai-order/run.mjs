#!/usr/bin/env node
/**
 * C019: inbox → локальный ИИ (OpenAI-совместимый /v1) → Excel в out/.
 *   node tools/local-ai-order/run.mjs
 *   node tools/local-ai-order/run.mjs --check
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { writeOrderXlsx } from './write-xlsx.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const inbox = path.join(root, 'inbox');
const outDir = path.join(root, 'out');
const settingsPath = path.join(root, 'settings.json');
const examplePath = path.join(root, 'settings.example.json');
const promptPath = path.join(root, 'PROMPT.md');
const require = createRequire(import.meta.url);

function loadSettings() {
  if (!fs.existsSync(settingsPath)) {
    if (!fs.existsSync(examplePath)) throw new Error('Нет settings.example.json');
    fs.copyFileSync(examplePath, settingsPath);
    console.log('Создан settings.json из примера — проверьте baseUrl');
  }
  const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (!s.baseUrl) throw new Error('В settings.json укажите baseUrl (например http://10.8.1.11:1234/v1)');
  return s;
}

const trimUrl = (u) => String(u).replace(/\/+$/, '');

function loadFflate() {
  const backend = path.resolve(root, '../../backend');
  try { return require(require.resolve('fflate', { paths: [backend, process.cwd()] })); } catch { /* pnpm */ }
  const pnpm = path.join(backend, 'node_modules', '.pnpm');
  const dir = fs.existsSync(pnpm) && fs.readdirSync(pnpm).filter((d) => /^fflate@/.test(d)).sort().pop();
  if (!dir) throw new Error('Нужен fflate в backend/node_modules');
  return require(path.join(pnpm, dir, 'node_modules', 'fflate'));
}

function readUtf(file) {
  const buf = fs.readFileSync(file);
  let t = buf.toString('utf8');
  if (t.includes('\uFFFD')) t = buf.toString('latin1');
  return t.replace(/\0/g, '');
}

function extractFile(file) {
  const name = path.basename(file);
  const ext = path.extname(file).toLowerCase();
  if (['.txt', '.md', '.csv', '.json', '.log'].includes(ext)) return { name, text: readUtf(file).slice(0, 80000) };
  if (ext === '.docx') {
    try {
      const { unzipSync, strFromU8 } = loadFflate();
      const z = unzipSync(fs.readFileSync(file), { filter: (x) => x.name === 'word/document.xml' });
      const xml = strFromU8(z['word/document.xml'] || new Uint8Array());
      const text = xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n').replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      return { name, text: text.slice(0, 80000) };
    } catch (e) { return { name, text: `(DOCX не прочитан: ${e.message})` }; }
  }
  if (ext === '.xlsx') {
    try {
      const { unzipSync, strFromU8 } = loadFflate();
      const z = unzipSync(fs.readFileSync(file), { filter: (x) => /sharedStrings|sheet\d+\.xml/.test(x.name) });
      const shared = [];
      const ss = strFromU8(z['xl/sharedStrings.xml'] || new Uint8Array());
      for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        shared.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      }
      const parts = [];
      for (const key of Object.keys(z).filter((k) => /worksheets\/sheet\d+\.xml$/.test(k)).slice(0, 3)) {
        const cells = [];
        for (const c of strFromU8(z[key]).matchAll(/<c r="[A-Z]+\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const t = (c[1].match(/t="(\w+)"/) || [])[1];
          let v = (c[2] || '').match(/<v>([\s\S]*?)<\/v>/)?.[1];
          if (t === 's' && v != null) v = shared[+v];
          if (v) cells.push(String(v).slice(0, 200));
        }
        parts.push(cells.join(' | ').slice(0, 30000));
      }
      return { name, text: parts.join('\n---\n').slice(0, 80000) || '(пустой xlsx)' };
    } catch (e) { return { name, text: `(XLSX не прочитан: ${e.message})` }; }
  }
  if (['.pdf', '.doc', '.dwg', '.dxf', '.igs', '.bak'].includes(ext)) {
    return { name, text: `(бинарный ${ext} — только имя файла: ${name})` };
  }
  return null;
}

function authHeaders(s) {
  const key = s.apiKey != null ? String(s.apiKey).trim() : 'lm-studio';
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function fetchApi(s, path, init = {}) {
  const url = `${trimUrl(s.baseUrl)}${path}`;
  const attempts = [
    authHeaders(s),
    {}, // без Authorization — часть сборок LM Studio
    { Authorization: 'Bearer lm-studio' },
  ];
  let last = null;
  for (const headers of attempts) {
    const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), ...headers } });
    if (r.ok) return r;
    last = r;
    if (r.status !== 401) break;
  }
  throw new Error(`Связь ${url}: HTTP ${last?.status}. Проверьте LM Studio Running, CORS и baseUrl`);
}

async function check(s) {
  const r = await fetchApi(s, '/models');
  const j = await r.json();
  const ids = (j.data || []).map((m) => m.id).filter(Boolean);
  console.log('Связь OK:', trimUrl(s.baseUrl));
  console.log('Модели:', ids.slice(0, 10).join(', ') || '(пусто — укажите model в settings.json)');
  return ids;
}

function parseJsonAnswer(text) {
  const raw = String(text || '').trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('ИИ не вернул JSON-объект');
  return JSON.parse(body.slice(start, end + 1));
}

async function askModel(s, system, user) {
  const url = `${trimUrl(s.baseUrl)}/chat/completions`;
  const model = s.model || 'local-model';
  const r = await fetchApi(s, '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: s.temperature ?? 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const j = await r.json();
  const content = j.choices?.[0]?.message?.content;
  if (!content) throw new Error('Пустой ответ модели');
  return content;
}

async function build() {
  const s = loadSettings();
  fs.mkdirSync(inbox, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const files = fs.readdirSync(inbox).filter((f) => !f.startsWith('.') && !f.startsWith('~$') && f !== 'README.md');
  if (!files.length) throw new Error(`Папка входящих пуста: ${inbox}`);
  console.log(`Файлов во входящих: ${files.length}`);
  const extracts = [];
  for (const f of files) {
    const full = path.join(inbox, f);
    if (!fs.statSync(full).isFile()) continue;
    const ex = extractFile(full);
    if (ex) {
      extracts.push(ex);
      console.log('·', ex.name, `(${ex.text.length} знаков)`);
    }
  }
  if (!extracts.length) throw new Error('Не удалось извлечь текст ни из одного файла');
  const system = fs.readFileSync(promptPath, 'utf8');
  const user = extracts.map((e) => `### Файл: ${e.name}\n${e.text}`).join('\n\n').slice(0, 120000);
  console.log('Запрос к локальному ИИ…');
  const answer = await askModel(s, system, user);
  const order = parseJsonAnswer(answer);
  if (!Array.isArray(order.lines) || !order.lines.length) throw new Error('В ответе ИИ нет позиций lines[]');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const safe = String(order.orderNo || order.customer || 'заказ').replace(/[\\/:*?"<>|]/g, ' ').slice(0, 60).trim();
  const outFile = path.join(outDir, `заказ-${safe}-${stamp}.xlsx`);
  writeOrderXlsx(outFile, order);
  fs.writeFileSync(outFile.replace(/\.xlsx$/i, '.json'), JSON.stringify(order, null, 2), 'utf8');
  console.log('');
  console.log('Готово. Заберите файл:');
  console.log(outFile);
  if (order.skipped?.length) {
    console.log('Пропущено ИИ:');
    for (const x of order.skipped) console.log(' -', x);
  }
  console.log(`Позиций: ${order.lines.length}. Дальше: сайт → Заказы → Импорт Excel.`);
  return outFile;
}

const arg = process.argv[2];
try {
  if (arg === '--check') await check(loadSettings());
  else await build();
} catch (e) {
  console.error('Ошибка:', e.message || e);
  process.exit(1);
}
