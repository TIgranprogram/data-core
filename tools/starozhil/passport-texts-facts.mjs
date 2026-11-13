#!/usr/bin/env node
// Старожил: тексты паспортов — пронумерованными строками для вычитки локальным ИИ.
//   node tools/starozhil/passport-texts-facts.mjs → tools/logs/starozhil/passport-texts/<КОД>.md (ALL, TRN, WRK, DSP, BLG, DIO)
// Источник: backend/scripts/passport-texts.v2.json (тексты «Для всех» и типов паспорта). Ничего не меняет.
// Программа сама ловит механические огрехи (двойные пробелы, пустые {метки}, точки) — модель тратит шаги на смысл и грамотность.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'backend', 'scripts', 'passport-texts.v2.json');
const OUT = path.join(ROOT, 'tools', 'logs', 'starozhil', 'passport-texts');

/** Механические огрехи одной фразы — без модели. */
export function mechanical(t) {
  const raw = String(t || ''); const bad = [];
  if (/\{\s*\}|\{[^}]*$|^[^{]*\}/.test(raw)) bad.push('сломанная {метка}');
  const s = raw.replace(/\{[^{}]*\}/g, 'Х'); // подстановки ({std:SP_70}, {name}) не проверяем
  if (/ {2,}/.test(s)) bad.push('двойной пробел');
  if (/\s[,.;:!?]/.test(s)) bad.push('пробел перед знаком');
  if (/[,;:](?=[^\s\d»)])/.test(s)) bad.push('нет пробела после знака');
  if (/undefined|null|NaN/.test(s)) bad.push('служебное слово');
  if (s.trim() && !/[.!?:;»)]$/.test(s.trim())) bad.push('нет знака в конце');
  if (/(^|[а-яё]{4,}[.!?]\s+)[а-яё]/.test(s)) // после сокращений («мес. со дня») строчная — норма bad.push('предложение со строчной буквы');
  if (/\b([А-Яа-яЁё]{3,})\s+\1\b/i.test(s)) bad.push('слово повторено');
  return bad;
}

/** Все фразы кода: «раздел · id · текст». */
export function linesOf(block) {
  const out = [];
  for (const sec of block?.sections || []) {
    (sec.paragraphs || []).forEach((p, i) => out.push({ sec: sec.title || sec.key, id: (sec.ids || [])[i] || `п${i + 1}`, text: String(p) }));
  }
  // таблицы — пустые бланки: вычитываем заголовок и шапки столбцов (rows — число пустых строк)
  for (const tb of [].concat(block?.tables || [])) {
    if (tb?.title) out.push({ sec: 'таблица', id: tb.key || 'т', text: String(tb.title), head: true });
    (tb?.columns || []).forEach((c, i) => out.push({ sec: `таблица ${tb.key || ''}`.trim(), id: `столбец ${i + 1}`, text: String(c), head: true }));
  }
  return out;
}

function main() {
  const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  fs.mkdirSync(OUT, { recursive: true });
  const summary = [];
  for (const [code, block] of Object.entries(data)) {
    const rows = linesOf(block);
    const mech = [];
    const body = rows.map((r, i) => {
      const bad = mechanical(r.text).filter((b) => !(r.head && b === 'нет знака в конце')); // заголовки — без точки
      if (bad.length) mech.push(`- ${code}-${i + 1} (${r.id}): ${bad.join(', ')}`);
      return `${code}-${i + 1} | ${r.sec} | ${r.id} | ${r.text}`;
    });
    fs.writeFileSync(path.join(OUT, `${code}.md`), [
      `# Тексты паспорта: ${code} — ${rows.length} фраз`,
      'Формат строки: номер | раздел | id пункта | текст. {метки} в фигурных скобках — подстановки, их не править.',
      '', ...body, '', `## Механические огрехи (нашла программа): ${mech.length}`, ...(mech.length ? mech : ['нет']), '',
    ].join('\n'));
    summary.push(`${code}: фраз ${rows.length}, механических огрехов ${mech.length}`);
  }
  console.log(`Тексты паспортов разложены: ${summary.join(' · ')} → tools/logs/starozhil/passport-texts/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
