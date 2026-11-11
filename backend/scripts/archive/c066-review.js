/* C066: читаемый список для менеджера из plan.json. node scripts/c066-review.js <plan.json> > REVIEW.md */
const p = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const FIELDS = ['maxUsers', 'ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax'];
const LABELS = {
  maxUsers: 'Пользователей одновременно',
  ageFrom: 'Возраст от', ageTo: 'Возраст до',
  heightMin: 'Рост от', heightMax: 'Рост до',
  weightMax: 'Вес пользователя до',
};
const L = [];
L.push('# C066 — пользователи, возраст, рост, вес', '');
L.push(`План от ${String(p.at || '').slice(0, 10)}. На прод пока ничего не записано: запись — кнопка пульта «Паспорта: пользователи, возраст, рост, вес». Пишется только в пустые поля; выданные паспорта не меняются.`, '');
L.push('## Итог', '');
for (const f of FIELDS) L.push(`- «${LABELS[f]}»: получат ${p.stats[f] || 0} изделий, вручную ${p.stats[`manual_${f}`] || 0}.`);
L.push('', '## Правила', '');
L.push('- Сначала — число из **выпущенного** паспорта этого изделия.');
L.push('- Нет — как у **большинства группы** (≥ 2 заполненных и ≥ 80 % одного значения).');
L.push('- Тренажёры (категория TRN / группа «Тренажеры») — **maxUsers = 1**.');
L.push('- Неуверенное — в «вручную», не пишется.', '');
const grp = (p.rules && p.rules.group) || {};
for (const f of FIELDS) {
  const g = grp[f] || {};
  const keys = Object.keys(g);
  if (!keys.length) continue;
  L.push(`### Группы для «${LABELS[f]}»`);
  for (const [name, v] of Object.entries(g).sort()) L.push(`- ${name}: ${v.value} (${v.n} из ${v.total})`);
  L.push('');
}
L.push('## По группам', '');
const groups = [...new Set([...p.set, ...p.manual].map((x) => x.group || '(без группы)'))].sort();
for (const g of groups) {
  const s = p.set.filter((x) => (x.group || '(без группы)') === g);
  const m = p.manual.filter((x) => (x.group || '(без группы)') === g);
  L.push(`### ${g} — запись: ${s.length}, вручную: ${m.length}`, '');
  const by = {};
  for (const x of s) for (const f of FIELDS) if (x.why && x.why[f]) {
    const key = `${LABELS[f]}: ${x.why[f]}${x.set[f] != null ? ` → ${x.set[f]}` : ''}`;
    (by[key] = by[key] || []).push(x.name);
  }
  for (const [k, names] of Object.entries(by).sort()) L.push(`- ${k} — ${names.length}`);
  if (m.length) {
    L.push('', 'Вручную:');
    for (const x of m) L.push(`- ${(x.sku || '').slice(0, 20)} ${String(x.name || '').slice(0, 50)} — ${x.need.map((k) => LABELS[k] || k).join(', ')}`);
  }
  L.push('');
}
process.stdout.write(`${L.join('\n')}\n`);
