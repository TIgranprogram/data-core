#!/usr/bin/env node
// Старожил: карточки знаний (starozhil/cards/*.md).
//   node tools/starozhil/cards.mjs --check          все карточки: свежие / устарели / сломаны (для dc check). Выход 1 — есть сломанные
//   node tools/starozhil/cards.mjs --stamp <файл>   Claude принял карточку: записать отпечаток источников
// У карточки в свойствах: sources: [файлы от корня], hash: отпечаток. Источник изменился → «устарела» → наряд пересобирает.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseFront, sourcesHash, cardState } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CARDS = path.join(ROOT, 'starozhil', 'cards');
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; } };

export function cardsReport() {
  const files = fs.existsSync(CARDS) ? fs.readdirSync(CARDS).filter((f) => f.endsWith('.md') && f !== 'README.md') : [];
  return files.map((f) => {
    const { meta } = parseFront(fs.readFileSync(path.join(CARDS, f), 'utf8'));
    const src = [].concat(meta.sources || []);
    return { file: f, ...cardState(meta, src.length ? sourcesHash(src.map(read)) : null) };
  });
}

function stamp(name) {
  const f = path.join(CARDS, path.basename(name));
  const text = fs.readFileSync(f, 'utf8');
  const { meta } = parseFront(text);
  const h = sourcesHash([].concat(meta.sources || []).map(read));
  if (!h) { console.log('❌ Нет sources или источник не найден.'); return 2; }
  const next = /^hash:.*$/m.test(text) ? text.replace(/^hash:.*$/m, `hash: ${h}`) : text.replace(/^---\r?\n/, `---\nhash: ${h}\n`);
  const dated = /^checked:.*$/m.test(next) ? next.replace(/^checked:.*$/m, `checked: ${new Date().toISOString().slice(0, 10)}`) : next;
  fs.writeFileSync(f, dated);
  console.log(`Карточка ${path.basename(f)} принята, отпечаток ${h}.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  if (a[0] === '--stamp' && a[1]) process.exit(stamp(a[1]));
  const r = cardsReport();
  const by = (s) => r.filter((x) => x.state === s);
  console.log(`карточки: ${r.length}, свежих ${by('ok').length}, устарели ${by('stale').length}, сломаны ${by('broken').length}`);
  for (const x of [...by('broken'), ...by('stale')]) console.log(`  ${x.state === 'broken' ? '✖' : '⚠'} ${x.file} — ${x.why}`);
  process.exit(by('broken').length ? 1 : 0);
}
