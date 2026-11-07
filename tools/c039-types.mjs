// C039: типы позиций прода → семейства → иконки (отчёт покрытия). node tools/c039-types.mjs [--list]
import { readFileSync } from 'node:fs';
import { index, typeGroups, TYPE_ALL } from '../backend/pwa/core/facets.js';
import { typeIconKind } from '../backend/pwa/ui/cat-art.js';
const rows = readFileSync(new URL('./logs/c039-stock-names.tsv', import.meta.url), 'utf8').split(/\r?\n/).slice(1).filter(Boolean)
  .map((l) => { const [name, categoryName] = l.split('\t'); return { name, categoryName: categoryName || '', categoryId: categoryName || 'none' }; });
index(rows);
const groups = typeGroups(rows);
let types = 0, own = 0, fam = 0, none = 0;
const out = [];
for (const g of groups) {
  out.push(`## ${g.label} (${g.count} поз., ${g.types.length} тип.)`);
  for (const t of g.types) {
    types++;
    const k = typeIconKind(t.label);
    if (k.own) own++; else if (k.family) fam++; else none++;
    out.push(`- ${t.label} | ${t.count} | ${k.own ? 'своя:' + k.own : k.family ? 'семейства:' + k.family : 'НЕТ'}`);
  }
}
console.log(out.join('\n'));
console.log(`\nТипов: ${types}; своя иконка: ${own} (${(own / types * 100).toFixed(0)}%); иконка семейства: ${fam} (${(fam / types * 100).toFixed(0)}%); без иконки: ${none}; семейств: ${groups.length}`);
