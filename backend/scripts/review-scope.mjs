// Объём проверки для агентов-проверяющих (архитектор, дизайнер) — экономия токенов: только то, что изменилось
// с их прошлой проверки. Журнал — .claude/review/<агент>.json: { commit, at, files: { путь: blob-хеш git } }.
//
//   node backend/scripts/review-scope.mjs architect          — что проверять: коммиты, файлы по областям, автопроверки
//   node backend/scripts/review-scope.mjs architect --done   — отметить «проверено до HEAD» (после проверки и записи вывода)
//   … designer [--done]                                       — то же для дизайнера (только pwa/admin и DESIGN/CANON)
//   … architect --baseline <коммит>                           — стартовая точка: всё из этого коммита считать проверенным
//
// Файл, чей blob-хеш не менялся с прошлой проверки, перечитывать не нужно — он уже проверен.
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (args) => execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const [agent = 'architect', flag] = process.argv.slice(2);
const SCOPE = {
  architect: (f) => /^backend\/(src|pwa|admin|scripts|test)\//.test(f) || /^(docker-compose|deploy\/)/.test(f) || /^docs\/(ARCH-PLAN|ARCHITECTURE|MAP)\.md$/.test(f),
  designer: (f) => /^backend\/(pwa|admin)\//.test(f) && /\.(js|css|html)$/.test(f) || /^docs\/(DESIGN|CANON)\.md$/.test(f),
};
const inScope = SCOPE[agent];
if (!inScope) { console.error(`Неизвестный агент «${agent}»: architect | designer`); process.exit(1); }
const ledgerPath = join(ROOT, '.claude', 'review', `${agent}.json`);
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : { commit: null, files: {} };
const head = git('rev-parse --short HEAD');
const blobs = Object.fromEntries(git('ls-files -s').split('\n').filter(Boolean).map((l) => { const m = /^\d+ ([0-9a-f]+) \d+\t(.+)$/.exec(l); return m ? [m[2], m[1].slice(0, 12)] : null; }).filter(Boolean));

if (flag === '--done' || flag === '--baseline') {
  // --baseline <коммит>: считать проверенным всё, что было в этом коммите (стартовая точка журнала)
  const at = flag === '--baseline' ? process.argv[4] : null;
  const src = at ? Object.fromEntries(git(`ls-tree -r ${at}`).split('\n').filter(Boolean).map((l) => { const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(l); return m ? [m[2], m[1].slice(0, 12)] : null; }).filter(Boolean)) : blobs;
  const files = Object.fromEntries(Object.entries(src).filter(([f]) => inScope(f)));
  const commitMark = at ? git(`rev-parse --short ${at}`) : head;
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, JSON.stringify({ commit: commitMark, at: new Date().toISOString(), files }, null, 1) + '\n');
  console.log(`${agent}: проверено до ${commitMark} (${Object.keys(files).length} файлов в журнале)`);
  process.exit(0);
}

// коммит из журнала есть в истории? (без перенаправлений оболочки — на Windows execSync идёт через cmd)
const exists = (c) => { try { execSync(`git merge-base --is-ancestor ${c} HEAD`, { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; } };
const since = ledger.commit && exists(ledger.commit) ? ledger.commit : null;
const changed = Object.keys(blobs).filter((f) => inScope(f) && ledger.files[f] !== blobs[f]);
const removed = Object.keys(ledger.files).filter((f) => !blobs[f]);
const area = (f) => (f.match(/^backend\/src\/modules\/([^/]+)/)?.[1] ? 'модуль ' + f.match(/^backend\/src\/modules\/([^/]+)/)[1]
  : f.startsWith('backend/src/common') ? 'common' : f.startsWith('backend/pwa') ? 'приложение (pwa)' : f.startsWith('backend/admin') ? 'админка'
    : f.startsWith('backend/test') ? 'e2e' : f.startsWith('backend/scripts') ? 'скрипты' : 'прочее');
const groups = {};
for (const f of changed) (groups[area(f)] ||= []).push(f);
const stat = since ? git(`diff --shortstat ${since}..HEAD -- ${changed.length ? '.' : ''}`) : '';

console.log(`Агент: ${agent} · прошлая проверка: ${ledger.commit ? `${ledger.commit} (${ledger.at?.slice(0, 10)})` : 'не было — первая полная'} · сейчас: ${head}`);
if (since) console.log(`Коммиты с прошлой проверки:\n${git(`log --format="%h %s" ${since}..HEAD`).split('\n').filter(Boolean).map((l) => '  ' + l.slice(0, 110)).join('\n') || '  нет'}${stat ? '\n  ' + stat : ''}`);
console.log(`\nИзменённых файлов в зоне проверки: ${changed.length}${removed.length ? `, удалено: ${removed.length}` : ''} (остальные не менялись — не перечитывать)`);
for (const [g, fs] of Object.entries(groups).sort()) {
  console.log(`  ${g}:`);
  for (const f of fs.sort()) {
    let lines = '';
    try { lines = since ? git(`diff --numstat ${since}..HEAD -- "${f}"`).split('\t').slice(0, 2).join('/') : ''; } catch { /* новый файл */ }
    console.log(`    ${f}${lines ? `  (+/- ${lines})` : ''}`);
  }
}
console.log(`\nАвтопроверки (запускать только нужные — по областям выше):
  tsc:            cd backend && npx tsc --noEmit
  юнит модуля:    cd backend && npx jest src/modules/<модуль> --silent
  циклы модулей:  node backend/scripts/audit-cycles.js
  размер файлов:  >500 строк в modules/* (не spec) — кандидат на разрез
  pwa:            node --input-type=module --check < файл; npx jest src/pwa-guards --silent (modulepreload, глобальные имена)
Отметить проверенное: node backend/scripts/review-scope.mjs ${agent} --done`);
