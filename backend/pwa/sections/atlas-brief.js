// Сводка блока «Карты сайта» для ИИ и проверка карты (C097, план REVIEW-GPT шаг 2).
// Без DOM и без файловой системы: тот же модуль читают окно на сайте (кнопка «Сводка для ИИ»),
// `tools/dc.mjs atlas <блок>` и `dc check` (проверка структуры). Проверку путей к файлам делает dc.
import { BANDS, NODES, LINKS } from './atlas-data.js';
import { SECTIONS, SCENARIOS } from './help-guide-data.js';

const byId = new Map(NODES.map((n) => [n.id, n]));
const bandName = (n) => BANDS.find((b) => b.id === n.band)?.name || n.band;
const nameOf = (n) => (n.t === 'ИЗДЕЛИЕ' ? 'Изделие' : n.t);
/** Документ «путь — раздел» → { path, section }. */
export const docRef = (d) => { const [path, ...rest] = String(d).split(' — '); return { path: path.trim(), section: rest.join(' — ').trim() || null }; };
const hrefOf = (n) => n.href || (n.sec ? SECTIONS[n.sec]?.href : null) || null;

/** Найти блоки по id, названию или слову из шагов (для `dc atlas <слово>`). */
export function findNodes(q) {
  const w = String(q || '').trim().toLowerCase();
  if (!w) return [];
  if (byId.has(w)) return [byId.get(w)];
  const hit = (n) => [n.id, n.t, ...n.l, ...(n.inside || []).flatMap((p) => [p.t, p.l])].join(' ').toLowerCase().includes(w);
  return NODES.filter(hit);
}

/** Сводка блока объектом — для локальных моделей и инструментов (`dc atlas <id> --json`). */
export function atlasJson(id) {
  const n = byId.get(id);
  if (!n) return null;
  const ins = LINKS.filter(([, b]) => b === id), outs = LINKS.filter(([a]) => a === id);
  const stepOf = (key, other) => (n.inside || []).filter((p) => (p[key] || []).includes(other)).map((p) => `${id}.${p.id}`);
  return {
    id, title: nameOf(n), layer: bandName(n), route: hrefOf(n), status: n.plan === 'идея' ? 'идея — в очереди нет, решает владелец' : n.plan ? `в разработке (${n.plan})` : 'работает',
    purpose: (n.sec && SECTIONS[n.sec]?.what) || n.l.join(' '),
    ordered: !!n.seq,
    steps: (n.inside || []).map((p) => ({ id: `${id}.${p.id}`, title: p.t, note: p.l, ...(p.alt ? { aside: true } : {}), ...(p.plan ? { plan: p.plan } : {}) })),
    incoming: ins.map(([a, , label]) => ({ from: a, what: label, into: stepOf('in', a) })),
    outgoing: outs.map(([, b, label]) => ({ to: b, what: label, from: stepOf('out', b) })),
    rules: n.rules || [],
    docs: (n.docs || []).map(docRef),
    code: n.code || [],
    tables: n.tech || null,
    howto: (n.sec && SECTIONS[n.sec]?.steps?.map((st) => st.t)) || [],
    scenarios: SCENARIOS.filter((sc) => (sc.href || '').split('?')[0] === (hrefOf(n) || '').split('?')[0]).map((sc) => sc.want),
  };
}

/** Сводка блока текстом — коротко, чтобы вставить в промпт любой модели. */
export function atlasBrief(id) {
  const j = atlasJson(id);
  if (!j) return `Блока «${id}» на карте нет.`;
  const L = [];
  L.push(`# ${j.title} — ${j.layer}${j.route ? ` (${j.route})` : ''} · ${j.status}`);
  L.push(j.purpose);
  if (j.steps.length) {
    L.push(j.ordered ? 'Шаги по порядку:' : 'Из чего состоит:');
    j.steps.forEach((st, i) => L.push(`${j.ordered && !st.aside ? `${i + 1}.` : '-'} ${st.title} — ${st.note}${st.plan ? ` [${st.plan === 'идея' ? 'идея' : 'в разработке ' + st.plan}]` : st.aside ? ' [ещё в разделе]' : ''} {${st.id}}`));
  }
  if (j.incoming.length) L.push('Приходит:', ...j.incoming.map((x) => `- из «${nameOf(byId.get(x.from))}»: ${x.what} → ${x.into.join(', ') || 'в раздел'}`));
  if (j.outgoing.length) L.push('Уходит:', ...j.outgoing.map((x) => `- в «${nameOf(byId.get(x.to))}»: ${x.what} ← ${x.from.join(', ') || 'из раздела'}`));
  if (j.rules.length) L.push('Учитывать:', ...j.rules.map((r) => `- ${r}`));
  if (j.code.length) L.push('Код: ' + j.code.join(', '));
  if (j.tables) L.push('Таблицы: ' + j.tables);
  if (j.docs.length) L.push('Документы: ' + j.docs.map((d) => d.path + (d.section ? ` (${d.section})` : '')).join('; '));
  L.push(`Карта: #atlas?n=${j.id} · данные: backend/pwa/sections/atlas-data.js — после изменения поведения обновить блок и прогнать dc check.`);
  return L.join('\n');
}

/** Список блоков одной строкой на блок (`dc atlas` без аргумента). */
export const atlasList = () => BANDS.map((b) => `${b.name}: ` + NODES.filter((n) => n.band === b.id).map((n) => `${n.id}${n.plan ? '*' : ''}`).join(', ')).join('\n') + '\n* — в разработке';

/** Проверка структуры карты (без файлов). Возвращает список ошибок (пусто — порядок). */
export function atlasProblems(data = { BANDS, NODES, LINKS }) {
  const { BANDS: bands, NODES: nodes, LINKS: links } = data; // данные можно подменить в тесте
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const bad = [];
  const ids = new Set(), cells = new Set(), pairs = new Set();
  for (const n of nodes) {
    if (ids.has(n.id)) bad.push(`повтор блока ${n.id}`); ids.add(n.id);
    if (!bands.some((b) => b.id === n.band)) bad.push(`${n.id}: нет слоя ${n.band}`);
    const cell = `${n.band}:${n.col}`; if (cells.has(cell)) bad.push(`${n.id}: место ${cell} занято`); cells.add(cell);
    if (!(n.col >= 0 && n.col <= 3)) bad.push(`${n.id}: колонка ${n.col} вне 0–3`);
    if (n.sec && !SECTIONS[n.sec]) bad.push(`${n.id}: нет раздела ${n.sec} в help-guide-data`);
    if (!n.plan && !hrefOf(n) && !n.where) bad.push(`${n.id}: нет адреса и «где найти»`);
    if (!n.plan && !(n.code || []).length) bad.push(`${n.id}: не указан код (code)`);
    const steps = new Set();
    for (const p of n.inside || []) {
      if (!p.id) bad.push(`${n.id}: шаг «${p.t}» без id`);
      else if (steps.has(p.id)) bad.push(`${n.id}: повтор шага ${p.id}`);
      steps.add(p.id);
      for (const x of p.in || []) if (!links.some(([a, b]) => a === x && b === n.id)) bad.push(`${n.id}.${p.id}: вход из ${x}, а связи ${x}→${n.id} нет`);
      for (const x of p.out || []) if (!links.some(([a, b]) => a === n.id && b === x)) bad.push(`${n.id}.${p.id}: выход в ${x}, а связи ${n.id}→${x} нет`);
    }
    for (const d of n.docs || []) if (!/^docs\/|^backend\/|^deploy\/|^tools\//.test(docRef(d).path)) bad.push(`${n.id}: документ без пути «${d}»`);
  }
  for (const [a, b, label] of links) {
    const A = byId.get(a), B = byId.get(b);
    if (!A || !B) { bad.push(`связь ${a}→${b}: нет блока`); continue; }
    const k = `${a}>${b}`; if (pairs.has(k)) bad.push(`повтор связи ${k}`); pairs.add(k);
    if (!label) bad.push(`связь ${k} без подписи`);
    if (!(A.inside || []).some((p) => (p.out || []).includes(b))) bad.push(`связь ${k}: ни один шаг ${a} её не отдаёт`);
    if (!(B.inside || []).some((p) => (p.in || []).includes(a))) bad.push(`связь ${k}: ни один шаг ${b} её не принимает`);
  }
  return bad;
}
