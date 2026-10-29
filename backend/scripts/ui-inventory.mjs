// Аудит приложения (pwa): перечень экранов, кнопок, подписей, запросов к API и способов открытия (правая панель / окно / переход).
// Не читает код глазами — собирает всё подряд, чтобы аудит ничего не пропустил. Запуск из backend/: node scripts/ui-inventory.mjs [выход.md]
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../pwa/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const out = process.argv[2] || join(ROOT, '../../docs/audit/ui-inventory.md');
const files = ['sections', 'ui', 'core'].flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith('.js') && !f.endsWith('.test.mjs')).map((f) => join(ROOT, d, f)))
  .concat(join(ROOT, 'main.js'));

const all = (re, s) => [...s.matchAll(re)].map((m) => m[1].trim()).filter(Boolean);
const uniq = (a) => [...new Set(a)];
const STR = `'((?:[^'\\\\\\n]|\\\\.){2,120})'`; // строка в одинарных кавычках

const rows = files.map((p) => {
  const s = readFileSync(p, 'utf8');
  const name = relative(ROOT, p).replace(/\\/g, '/');
  return {
    name, bytes: statSync(p).size, lines: s.split('\n').length,
    buttons: uniq(all(new RegExp(`h\\('button',\\s*\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\},\\s*${STR}`, 'g'), s)),
    labels: uniq(all(new RegExp(`\\blabel:\\s*${STR}`, 'g'), s)),
    titles: uniq(all(new RegExp(`\\btitle:\\s*${STR}`, 'g'), s)),
    api: uniq(all(/\bapi\(\s*[`'"](\/[A-Za-z0-9_\-/]*)/g, s).map((x) => x.replace(/\/$/, ''))),
    panel: (s.match(/patch\(\{\s*of:/g) || []).length + (s.match(/openCard\(/g) || []).length,
    modal: (s.match(/\bmodal\(\{/g) || []).length,
    confirm: (s.match(/\bconfirmDlg\(/g) || []).length,
    go: (s.match(/\bgo\('/g) || []).length,
    imports: all(/from '([^']+)'/g, s).length + all(/import\('([^']+)'\)/g, s).length,
  };
});

const index = (key) => {
  const m = new Map();
  for (const r of rows) for (const v of r[key]) m.set(v, [...(m.get(v) || []), r.name]);
  return [...m].filter(([, fs]) => fs.length > 1).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ru'));
};
const esc = (x) => String(x).replace(/\|/g, '\\|');
const kb = (n) => (n / 1024).toFixed(1);

const L = [];
L.push('# Перечень приложения «Рабочее место» (собран скриптом)', '');
L.push(`Создан: \`node backend/scripts/ui-inventory.mjs\`. Файлов: ${rows.length}, всего ${kb(rows.reduce((a, r) => a + r.bytes, 0))} КБ JS (без CSS).`, '');
L.push('Как читать: каждая строка — пункт проверки аудита. Ничего не отмечено «проверено» здесь: отметки — в `docs/audit/AUDIT-PLAN.md`.', '');

L.push('## 1. Файлы: размер и способы открытия', '');
L.push('| Файл | КБ | Строк | Правая панель | Окно (modal) | Подтверждение | Переход go() | Импортов |', '|--|--|--|--|--|--|--|--|');
for (const r of [...rows].sort((a, b) => b.bytes - a.bytes)) L.push(`| ${r.name} | ${kb(r.bytes)} | ${r.lines} | ${r.panel} | ${r.modal} | ${r.confirm} | ${r.go} | ${r.imports} |`);

L.push('', '## 2. Одна подпись — в нескольких файлах (кандидаты в дубли или в «одни слова»)', '');
L.push('| Подпись (label / кнопка) | Где |', '|--|--|');
const lab = new Map();
for (const r of rows) for (const v of uniq([...r.labels, ...r.buttons])) lab.set(v, [...(lab.get(v) || []), r.name]);
for (const [v, fs] of [...lab].filter(([, fs]) => fs.length > 1).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ru'))) L.push(`| ${esc(v)} | ${fs.join(', ')} |`);

L.push('', '## 3. Один запрос к API — из нескольких файлов (кандидаты в общий модуль или в лишнюю загрузку)', '');
L.push('| Путь | Файлов | Где |', '|--|--|--|');
for (const [v, fs] of index('api')) L.push(`| ${esc(v)} | ${fs.length} | ${fs.join(', ')} |`);

L.push('', '## 4. По файлам: кнопки, подписи, подсказки, запросы', '');
for (const r of rows.filter((x) => x.buttons.length + x.labels.length + x.api.length)) {
  L.push(`### ${r.name}`, '');
  if (r.buttons.length) L.push('- **Кнопки:** ' + r.buttons.map(esc).join(' · '));
  if (r.labels.length) L.push('- **Подписи:** ' + r.labels.map(esc).join(' · '));
  if (r.titles.length) L.push('- **Заголовки/подсказки:** ' + r.titles.map(esc).join(' · '));
  if (r.api.length) L.push('- **API:** ' + r.api.map((x) => '`' + x + '`').join(' '));
  L.push('');
}
writeFileSync(out, L.join('\n'));
console.log(`готово: ${out} — файлов ${rows.length}, дублей подписей ${[...lab].filter(([, fs]) => fs.length > 1).length}, общих запросов ${index('api').length}`);
