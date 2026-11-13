#!/usr/bin/env node
/**
 * «Продукция»: три главных раздела; изделия «Благоустройства» -> раздел «Оборудование для благоустройства территории», по подгруппам.
 *   node scripts/categories-regroup.js <local|prod>                              - план, ничего не пишет
 *   node scripts/categories-regroup.js <local|prod> --apply --out откат.json     - запись (PATCH /api/showcase/:id {type, group})
 *   доп. флаг: --min high|medium (по умолчанию medium) - какую уверенность переносить
 * Артикул не трогаем: в PATCH только type/group, поля sku нет (смена группы артикул не меняет; showcase.service update/fields).
 * Подгруппа берётся только СУЩЕСТВУЮЩАЯ в целевом разделе (нет номера groupNo - нельзя создавать автоматически: showcase.category
 * создала бы группу без номера). Нет подходящей - изделие остаётся, в плане - предложение новой подгруппы (создать в Справочники -> Группы изделий).
 * Ничего не удаляется; пустые старые группы/разделы - только пометка в плане.
 * Откат: для каждого изделия PATCH {type: old.type, group: old.group} из файла --out.
 */
const fs = require('fs');
const path = require('path');

const [env, ...flags] = process.argv.slice(2);
if (!['local', 'prod'].includes(env)) { console.error('usage: <local|prod> [--apply --out откат.json] [--min high|medium]'); process.exit(2); }
const APPLY = flags.includes('--apply');
const OUT = flags[flags.indexOf('--out') + 1];
if (APPLY && (!OUT || OUT.startsWith('--'))) { console.error('--apply требует --out откат.json'); process.exit(2); }
const MIN = flags.includes('--min') ? flags[flags.indexOf('--min') + 1] : 'medium';
const BASE = env === 'prod' ? 'https://kppdf-crm.ru/db' : 'http://localhost:3001';
const TARGET = 'Оборудование для благоустройства территории';
const MAIN = [TARGET, 'Оборудование для детских игровых площадок', 'Спортивное оборудование'];

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const stem = (w) => w.slice(0, 5);
const words = (s) => norm(s).replace(/[^a-zа-я0-9 ]/g, ' ').split(' ').filter((w) => w.length >= 3);
// синонимы: корень слова названия -> корни, которые считаем тем же словом в названии подгруппы
const SYN = { скаме: ['скамь'], лавка: ['скамь'], лавоч: ['скамь'], диван: ['скамь'], урна: ['урн', 'мусор'], мусор: ['урн'], контей: ['урн', 'мусор'], навес: ['беседк', 'навес'], павил: ['беседк', 'навес'], пергол: ['беседк', 'навес'], забор: ['огражд'], огражд: ['огражд'], барьер: ['огражд'], вазон: ['цветоч', 'клумб'], клумб: ['цветоч'], велопа: ['парков', 'велопа'], стойк: ['парков', 'велопа'], столи: ['стол', 'пикни'], стол: ['пикни', 'стол'], столы: ['стол'], лежак: ['шезло'], шезло: ['шезло'], светил: ['освещ', 'свети'], фонар: ['освещ', 'свети'], мостик: ['мост'], арка: ['арк'], качел: ['качел'] };

function creds() {
  const d = path.join(__dirname, '../../deploy/synology');
  const get = (k, f) => { try { const m = fs.readFileSync(path.join(d, f), 'utf8').match(new RegExp(`^${k}=(.*)$`, 'm')); return m ? m[1].replace(/["\r]/g, '') : ''; } catch { return ''; } };
  return { username: get('ACCESS_USER', 'access.env') || 'admin', password: get('ACCESS_PASSWORD', 'access.env') || get('ADMIN_PASSWORD', 'config.env') };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let token = '';
async function login() {
  const c = creds();
  if (!c.password) throw new Error('нет пароля (config.env / access.env)');
  const j = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) }).then((r) => r.json());
  token = j.access || j.tokens?.access;
  if (!token) throw new Error('вход не удался');
}
async function api(method, p, body) {
  for (let i = 0; ; i++) {
    await sleep(700); // лимит 100/мин
    const r = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429 && i < 5) { await sleep(15000); continue; }
    if (r.status === 401 && i < 2) { await sleep(13000); await login(); continue; } // перевход только на 401 (лимит входа 20/час)
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = txt; }
    if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${typeof j === 'object' ? j.message : txt.slice(0, 200)}`);
    return j;
  }
}

const KIDS = 'Оборудование для детских игровых площадок', SPORT = 'Спортивное оборудование';
// правила: [regexp по названию (ё=е, нижний регистр), раздел, regexp названия группы]; побеждает совпадение, стоящее в названии раньше всех,
// при равной позиции - правило выше в списке (фразы идут первыми)
const RULES = [
  [/беседк\S* детск|детск\S* беседк/, KIDS, /домик/],
  [/музыкальн\S* площадк/, KIDS, /детское игровое/],
  [/игров\S* комплекс/, KIDS, /игров|комплекс/],
  [/стойк\S* для сетк/, TARGET, /огражд/],
  [/секци\S* огражд/, TARGET, /огражд/],
  [/оградительн\S* систем/, SPORT, /огражд|оградит/],
  [/качалк\S*[- ]баланс/, KIDS, /балансир/],
  [/качалк/, KIDS, /на пружин/],
  [/качел|качель/, KIDS, /^качели/],
  [/карусел/, KIDS, /карусел/],
  [/горк/, KIDS, /горк/],
  [/геопластик|холм|пузыр|пончик|муравейник/, KIDS, /детское игровое/],
  [/бизиборд/, KIDS, /детское игровое/],
  [/воркаут/, SPORT, /воркаут/],
  [/судейск/, SPORT, /спорт оборуд/],
  [/урн/, TARGET, /урн/],
  [/пергол|беседк|навес|павильон/, TARGET, /навес|беседк|пергол/],
  [/огражден|калитк|столбик/, TARGET, /огражд/],
  [/стел[аыеу]?(?![а-я])|указател|стенд/, TARGET, /информац|указател|стенд/],
  [/стол/, TARGET, /стол/],
  [/скам|лавоч|лавк|пуфик|пенек|кресл/, TARGET, /скам/],
  [/амфитеатр|трибун/, TARGET, /трибун/],
  [/велопарков/, TARGET, /велопарков/],
  [/ваз(он|ы)/, TARGET, /вазон/],
  [/фонар|флагшток|костров/, TARGET, /невошедш|благоустройство/],
  [/детск/, KIDS, /детск/],
];
/** Подбор раздела и подгруппы по правилам (см. RULES). groups - все группы из справочника. */
function pick(product, sections, groups) {
  const t = norm(`${product.name}`);
  let best = null;
  RULES.forEach((r, i) => { const m = r[0].exec(t); if (m && (!best || m.index < best.idx)) best = { idx: m.index, r, i }; });
  const secName = best ? best.r[1] : TARGET;
  const sec = sections.find((s) => norm(s.name) === norm(secName));
  if (!sec) return { conf: 'low', group: null, why: `нет раздела «${secName}»` };
  const mine = groups.filter((g) => String(g.parentId) === String(sec.id));
  const g = best && mine.find((x) => best.r[2].test(norm(x.name)));
  if (g) return { conf: 'high', group: g, section: sec, why: '' };
  const rest = mine.find((x) => /невошедш/.test(norm(x.name)));
  if (rest) return { conf: 'medium', group: rest, section: sec, why: best ? 'нет группы по слову - в «невошедшее»' : 'нет правила - в «невошедшее»' };
  return { conf: 'low', group: null, why: `в разделе «${sec.name}» нет подходящей группы и «невошедшего»` };
}

(async () => {
  await login();
  const sections = (await api('GET', '/api/dicts/productSections')).items;
  const groups = (await api('GET', '/api/dicts/productGroups')).items;
  const secName = new Map(sections.map((s) => [String(s.id), s.name]));
  const target = sections.find((s) => norm(s.name) === norm(TARGET));
  console.log('Разделы изделий:'); sections.forEach((s) => console.log(`  ${MAIN.some((m) => norm(m) === norm(s.name)) ? '[главный]' : '[подкатегория? решает пользователь]'} ${s.name}  (групп: ${groups.filter((g) => String(g.parentId) === String(s.id)).length})`));
  MAIN.filter((m) => !sections.some((s) => norm(s.name) === norm(m))).forEach((m) => console.log(`  ⚠ нет раздела «${m}» - создать: Справочники → Разделы изделий`));
  if (!target) { console.log(`\nСТОП: раздела «${TARGET}» нет. Создайте его и повторите (скрипт разделы не создаёт).`); return; }

  // все живые изделия
  const items = []; for (let page = 1; ; page++) { const r = await api('GET', `/api/showcase?limit=500&page=${page}`); items.push(...r.items); if (items.length >= r.total || !r.items.length) break; }
  const tGroups = groups.filter((g) => String(g.parentId) === String(target.id));
  console.log(`\nИзделий всего: ${items.length}. Подгруппы раздела «${TARGET}»: ${tGroups.map((g) => `${g.name} (${g.groupNo})`).join('; ') || '—'}`);

  const isSrc = (p) => (/благоустр/i.test(p.type || '') || /благоустр/i.test(p.group || '')) && norm(p.type) !== norm(TARGET);
  const src = items.filter(isSrc);
  console.log(`Изделий «Благоустройства» вне целевого раздела: ${src.length}`);
  const rows = src.map((p) => ({ p, ...pick(p, sections, groups) }));
  const rank = { high: 2, medium: 1, low: 0 };
  const take = (r) => r.group && rank[r.conf] >= rank[MIN];
  console.log(`\nизделие | артикул (не меняется) | сейчас | -> подгруппа (уверенность)`);
  rows.filter((r) => r.conf !== 'low').forEach((r) => console.log(`  ${r.p.name} | ${r.p.sku} | ${r.p.type || '—'} / ${r.p.group || '—'} -> ${r.section.name} / ${r.group.name} (${r.conf}${r.why ? ', ' + r.why : ''})`));
  const low = rows.filter((r) => r.conf === 'low');
  console.log(`\nНИЗКАЯ уверенность / нет подгруппы (${low.length}) - остаются на месте, решает пользователь:`);
  low.forEach((r) => console.log(`  ${r.p.name} | ${r.p.sku} | сейчас ${r.p.type || '—'} / ${r.p.group || '—'} | ${r.why}`));
  const prop = {}; low.forEach((r) => { const k = r.p.group || 'без группы'; (prop[k] = prop[k] || []).push(r.p.name); });
  console.log('Предложение новых подгрупп (создать в «Группы изделий», с номером; потом повторить план):');
  Object.entries(prop).forEach(([k, v]) => console.log(`  «${k}» ← ${v.length} изд.: ${v.slice(0, 4).join('; ')}${v.length > 4 ? '…' : ''}`));

  // пустеющие старые группы / разделы - только пометка
  const moving = new Set(rows.filter(take).map((r) => r.p.id));
  const left = new Map(); items.forEach((p) => { if (!moving.has(p.id)) left.set(p.groupId, (left.get(p.groupId) || 0) + 1); });
  const emptied = groups.filter((g) => items.some((p) => p.groupId === String(g.id) && moving.has(p.id)) && !left.get(String(g.id)));
  console.log(`\nСтанут пустыми - можно убрать после проверки (не удаляется): ${emptied.map((g) => `${g.name} [${secName.get(String(g.parentId)) || '?'}]`).join('; ') || '—'}`);
  console.log(`К переносу: ${rows.filter(take).length} (порог «${MIN}»), останется: ${rows.length - rows.filter(take).length}.`);
  if (!APPLY) return console.log('план - ничего не записано; запись: --apply --out откат.json');

  const done = [];
  try {
    for (const r of rows.filter(take)) {
      await api('PATCH', `/api/showcase/${r.p.id}`, { type: r.section.name, group: r.group.name });
      done.push({ id: r.p.id, sku: r.p.sku, old: { type: r.p.type, group: r.p.group }, now: { type: r.section.name, group: r.group.name } });
    }
  } finally { fs.writeFileSync(OUT, JSON.stringify(done, null, 1)); }
  console.log(`перенесено ${done.length}; откат - PATCH /api/showcase/<id> {type: old.type, group: old.group} из ${OUT}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
