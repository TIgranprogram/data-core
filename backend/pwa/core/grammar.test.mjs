// Сторож грамматики (пользователь 2026-11-13: «из вид «Информационный стенд»»): правила и строки в исходниках приложения.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { grammarSlips } from './grammar.js';

const BAD = ['Тип паспорта: Благоустройство — из вид «Информационный стенд»', 'из группа «Скамьи»', 'для изделие 3207', 'в группа «Урны»',
  'по группа', 'тип тип паспорта', 'без категория', 'к заказ № 9'];
const GOOD = ['из вида «Информационный стенд»', 'из группы «Скамьи»', 'в раздел «Склад»', 'по группе', 'Вид изделия: Информационный стенд',
  'тип паспорта', 'Перевести в группу', 'ГОСТ 12.3.009–76', 'Назначение: Информирование', 'у изделия', 'на складе', 'в позиции 3', 'crumb crumb-group'];

test('ловит ошибки склонения и повтор слова', () => {
  for (const t of BAD) assert.ok(grammarSlips(t).length, `не поймано: ${t}`);
});

test('правильные фразы и CSS-классы не трогает', () => {
  for (const t of GOOD) assert.deepEqual(grammarSlips(t), [], `ложное срабатывание: ${t}`);
});

test('в строках исходников приложения нет ошибок склонения (вставки ${…} считаются пропуском)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (!['node_modules', 'vendor'].includes(f.name)) walk(p); } else if (f.name.endsWith('.js') && !f.name.includes('.test.')) files.push(p); } };
  walk(root);
  const found = [];
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/ .*$/, '')).join('\n');
    for (const s of code.match(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"/g) || []) {
      for (const g of grammarSlips(s.slice(1, -1).replace(/\$\{[^}]*\}/g, '…'))) found.push(`${path.relative(root, f)}: ${g.hint}: ${g.text}`);
    }
  }
  assert.deepEqual(found, []);
});

test('nextLine: «Дальше:» с одним двоеточием', async () => {
  const { nextLine } = await import('./grammar.js');
  assert.equal(nextLine('выберите тип паспорта'), 'Дальше: выберите тип паспорта');
  assert.equal(nextLine('уточните: нагрузка — по желанию'), 'Дальше: уточните — нагрузка — по желанию');
  assert.equal((nextLine('а: б: в').match(/:/g) || []).length, 1);
});
