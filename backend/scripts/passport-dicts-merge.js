#!/usr/bin/env node
/**
 * Чистка справочников паспортов (ПЧ-2): «Части изделия» по списку аудита, «Сортамент» — одно написание.
 *   node scripts/passport-dicts-merge.js <local|prod>                        - план, ничего не пишет
 *   node scripts/passport-dicts-merge.js <local|prod> --apply --out откат.json - запись
 * Только через deploy/synology/api.sh: объединение как кнопка «Объединить» в приложении, ссылки изделий и черновиков
 * переходят на оставшуюся запись, выпущенные паспорта не меняются, дубль — в корзину.
 * Сортамент: запятая, «×», «∅»; большая сторона первой — только у профильной трубы (у доски «толщина × ширина», у балок свой порядок). Части, которых нет, пропускаются.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const [env, ...flags] = process.argv.slice(2);
if (require.main === module && !['local', 'prod'].includes(env)) { console.error('usage: <local|prod> [--apply --out откат.json]'); process.exit(2); }
const APPLY = flags.includes('--apply');
const OUT = flags[flags.indexOf('--out') + 1];
if (require.main === module && APPLY && (!OUT || OUT.startsWith('--'))) { console.error('--apply требует --out откат.json'); process.exit(2); }
const API_SH = path.join(__dirname, '../../deploy/synology/api.sh').split(path.sep).join('/');

// дубль → оставшаяся запись; null — удалить как мусор
const PARTS = [['наполнение', null], ['фланец', 'Опорная пятка'], ['Фланцы', 'Опорная пятка'], ['Рама', 'Несущая рама'], ['Рукоять', 'Ручка']];

/** Единое написание размера: «∅33.5х2.8» → «∅33,5×2,8»; у профиля «40×80×2» → «80×40×2». */
function canon(name, material = '') {
  const s = String(name).trim().replace(/\s+/g, '').replace(/\./g, ',').replace(/[xхX*]/gi, '×').replace(/^[øØ⌀dD]/, '∅');
  const round = s.startsWith('∅');
  const p = s.replace(/^∅/, '').split('×');
  const n = (v) => Number(v.replace(',', '.'));
  if (!round && /PROFILE/.test(material) && p.length >= 2 && p.slice(0, 2).every((v) => Number.isFinite(n(v))) && n(p[0]) < n(p[1])) [p[0], p[1]] = [p[1], p[0]];
  return (round ? '∅' : '') + p.join('×');
}

/** Части: что объединить и что удалить. Точное написание: «фланец» и «Фланец» — разные записи. */
function planParts(items, pairs = PARTS) {
  const by = new Map(items.map((d) => [d.name, d]));
  const merge = [], remove = [], skip = [];
  for (const [from, to] of pairs) {
    const f = by.get(from);
    if (!f) { skip.push(`${from}: нет записи`); continue; }
    if (to === null) { remove.push(f); continue; }
    const t = by.get(to);
    if (!t) { skip.push(`${from} → ${to}: нет записи «${to}»`); continue; }
    merge.push({ from: f, to: t });
  }
  return { merge, remove, skip };
}

/** Сортамент: внутри материала записи с одним написанием объединяются в каноничную; нет такой — первая переименовывается. */
function planSortament(items) {
  const groups = new Map();
  for (const d of items) {
    const k = `${d.material || ''}|${canon(d.name, d.material)}`;
    groups.set(k, [...(groups.get(k) || []), d]);
  }
  const merge = [], rename = [];
  for (const [k, list] of groups) {
    const name = k.slice(k.indexOf('|') + 1);
    const keep = list.find((d) => d.name === name) || list[0];
    if (keep.name !== name) rename.push({ item: keep, name });
    for (const d of list) if (d !== keep) merge.push({ from: d, to: keep, name });
  }
  return { merge, rename };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, p, body) {
  const file = body ? path.join(os.tmpdir(), `dicts-merge-${process.pid}.json`).split(path.sep).join('/') : '';
  if (body) fs.writeFileSync(file, JSON.stringify(body));
  await sleep(700); // лимит 100/мин
  const txt = execFileSync('bash', [API_SH, env, method, p, ...(file ? [file] : [])], { encoding: 'utf8', maxBuffer: 1 << 28 });
  let j; try { j = JSON.parse(txt); } catch { throw new Error(`${method} ${p} → ${txt.slice(0, 200)}`); }
  if (j?.statusCode >= 400) throw new Error(`${method} ${p} → ${j.statusCode} ${j.message}`);
  return j;
}
async function all(key) {
  const out = [];
  for (let page = 1; ; page++) {
    const j = await api('GET', `/api/dicts/${key}?page=${page}&limit=500`);
    out.push(...(j.items || []));
    if (out.length >= (j.total ?? 0) || !(j.items || []).length) return out;
  }
}

async function main() {
  const parts = planParts(await all('passportParts'));
  const sort = planSortament(await all('passportSortament'));
  console.log(`Части: объединить ${parts.merge.length}, удалить ${parts.remove.length}`);
  for (const m of parts.merge) console.log(`  ${m.from.name} → ${m.to.name}`);
  for (const d of parts.remove) console.log(`  удалить: ${d.name}`);
  for (const s of parts.skip) console.log(`  пропуск: ${s}`);
  console.log(`\nСортамент: объединить ${sort.merge.length}, переименовать ${sort.rename.length}`);
  for (const r of sort.rename) console.log(`  ${r.item.material || ''} «${r.item.name}» → «${r.name}»`);
  for (const m of sort.merge) console.log(`  ${m.from.material || ''} «${m.from.name}» → «${m.name}»`);
  if (!APPLY) { console.log('\nНичего не записано (план). Записать: --apply --out откат.json'); return; }

  const done = [];
  const save = (x) => { done.push(x); fs.writeFileSync(OUT, JSON.stringify(done, null, 2)); };
  for (const r of sort.rename) { await api('PATCH', `/api/dicts/passportSortament/${r.item.id}`, { name: r.name }); save({ rename: r.item.id, from: r.item.name, to: r.name }); }
  for (const [key, list] of [['passportSortament', sort.merge], ['passportParts', parts.merge]]) {
    for (const m of list) { await api('POST', `/api/dicts/${key}/${m.from.id}/merge`, { intoId: m.to.id }); save({ merged: m.from.id, name: m.from.name, into: m.to.id }); }
  }
  for (const d of parts.remove) { await api('DELETE', `/api/dicts/passportParts/${d.id}`); save({ deleted: d.id, name: d.name }); }
  console.log(`\nГотово: изменений ${done.length}. Список: ${OUT}`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { canon, planParts, planSortament };
