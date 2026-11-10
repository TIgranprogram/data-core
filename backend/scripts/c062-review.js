/* C062: читаемый список для менеджера из plan.json. node scripts/c062-review.js <plan.json> > REVIEW.md */
const p = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const L = [];
const cnt = (k) => p.set.filter((x) => x.set[k] || (k === 'purpose' && x.set.textChoices)).length;
L.push('# C062 — назначение, элементы и способ установки', '');
L.push(`План от ${p.at.slice(0, 10)}. На прод пока ничего не записано: запись — кнопка пульта «Паспорта: назначение, элементы, установка». Пишется только в пустые поля; выданные паспорта не меняются.`, '');
L.push('## Итог', '');
L.push(`- «Назначение»: получат ${p.stats.purpose} изделий, вручную ${p.stats.manualPurpose}.`);
L.push(`- «Элементы»: получат ${p.stats.elements}, вручную ${p.stats.manualElements}.`);
L.push(`- «Способ установки»: получат ${p.stats.install}, вручную ${p.stats.manualInstall}.`, '');
L.push('## Правила', '');
L.push('- **Назначение** — вариант раздела «Назначение» по названию изделия и категории паспорта (баскетбол, брусья, кардио, ноги, отдых, ограждение…). Вариант должен подходить к категории; не подходит — вручную.');
L.push('- **Элементы** — по названию: «Брусья» → Брусья, «Комплекс воркаут «Два турника-брусья»» → Турник + Брусья, «Жим ногами» → Тренажёр для мышц ног и ягодиц. Если в названии есть деталь без элемента (кольца, канат, скалодром) или элемент не подходит к категории паспорта — вручную.');
L.push('- **Способ установки** — как у большинства изделий группы, где он уже выбран (не меньше 2 изделий и 80 % одного значения):');
for (const [g, v] of Object.entries(p.rules.installByGroup)) L.push(`  - ${g}: «${v.type}» (${v.n} из ${v.total})`);
L.push('  Остальные группы (Спорт оборудование, Качели, Скамьи, Трибуны, Благоустройство…) — вручную: у них способы разные.', '');
const mis = p.manual.filter((x) => /не подходит для/.test((x.why || {}).elements || ''));
if (mis.length) {
  const by = {}; for (const x of mis) { const k = x.why.elements.replace(/^категория паспорта \w+ не подходит для /, ''); by[k] = (by[k] || 0) + 1; }
  L.push('## Что даст быстрый выигрыш', '');
  L.push(`${mis.length} изделий не получили «Элементы» только из-за категории паспорта (категория изделия не входит в список элемента или выбрана странно):`);
  for (const [k, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) L.push(`- ${k}: ${n}`);
  L.push('Решение: добавить категорию в справочник «Элементы» или поправить категорию изделия — потом запустить план заново.', '');
}
const groups = [...new Set([...p.set, ...p.manual].map((x) => x.group || '(без группы)'))].sort();
L.push('## По группам', '');
for (const g of groups) {
  const s = p.set.filter((x) => (x.group || '(без группы)') === g);
  const m = p.manual.filter((x) => (x.group || '(без группы)') === g);
  L.push(`### ${g} — запись: ${s.length}, вручную: ${m.length}`, '');
  const by = {};
  for (const x of s) for (const k of ['purpose', 'elements', 'install']) if (x.why[k]) { const key = `${{ purpose: 'Назначение', elements: 'Элементы', install: 'Установка' }[k]}: ${x.why[k]}`; (by[key] = by[key] || []).push(x.name); }
  for (const [k, names] of Object.entries(by).sort()) L.push(`- ${k} — ${names.length}`);
  if (m.length) {
    L.push('', 'Вручную:');
    const seen = {};
    for (const x of m) { const key = `${x.name.slice(0, 70)} — ${x.need.join(', ')}`; seen[key] = (seen[key] || 0) + 1; }
    for (const [k, n] of Object.entries(seen)) L.push(`- ${k}${n > 1 ? ` (×${n})` : ''}`);
  }
  L.push('');
}
process.stdout.write(L.join('\n') + '\n');
