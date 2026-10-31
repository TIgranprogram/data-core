#!/usr/bin/env node
// Собирает pult/docs/КОМАНДЫ.md из catalog.mjs. Руками файл не правится. Запуск: node pult/gen-docs.mjs
// pult/test/catalog.test.mjs падает, если файл отстал от каталога.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS, NOT_ON_BUTTONS, RISKS, SECTIONS } from './catalog.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DOC_FILE = path.join(HERE, 'docs', 'КОМАНДЫ.md');
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function runText(run) {
  if (run.open) return `адрес ${run.open}`;
  if (run.folder) return `папка ${run.folder}`;
  if (run.deploy) return ['bash remote-access/deploy.sh (или release.sh)', ...run.deploy].join(' ');
  if (run.vm) return `на сервере: ${run.vm}`;
  const [name, args] = Object.entries(run).find(([k]) => k !== 'cwd');
  return `${run.cwd ? `${run.cwd}: ` : ''}${name} ${args.join(' ')}`;
}

export function renderDoc() {
  const out = [
    '# Команды пульта',
    '',
    '> Файл собран из `pult/catalog.mjs` командой `node pult/gen-docs.mjs`. Руками не править.',
    '',
    '| Отметка | Значит |',
    '|--|--|',
    ...Object.values(RISKS).map((r) => `| ${r.label} | ${r.hint} |`),
    '',
  ];
  for (const s of SECTIONS.filter((x) => COMMANDS.some((c) => c.section === x.id))) {
    out.push(`## ${s.title}`, '', s.hint, '', '| Кнопка | Когда нажимать | Отметка | Время | Ритм | Что запускает |', '|--|--|--|--|--|--|');
    for (const c of COMMANDS.filter((x) => x.section === s.id)) {
      const word = c.word ? ` (слово ${c.word})` : '';
      out.push(`| ${cell(c.title)} | ${cell(c.hint)} | ${RISKS[c.risk].label}${word} | ${c.time} | ${c.every ? `${c.every} дн.` : '—'} | \`${cell(runText(c.run))}\` |`);
    }
    out.push('');
  }
  out.push('## Скрипты без кнопки', '', '| Скрипт | Почему |', '|--|--|');
  for (const [f, why] of Object.entries(NOT_ON_BUTTONS)) out.push(`| \`${f}\` | ${cell(why)} |`);
  out.push('');
  return out.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.dirname(DOC_FILE), { recursive: true });
  fs.writeFileSync(DOC_FILE, renderDoc());
  console.log(`Готово: ${path.relative(process.cwd(), DOC_FILE)}`);
}
