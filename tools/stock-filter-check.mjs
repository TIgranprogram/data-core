// Проверка фильтров «Остатков» на стенде: у каждой категории и каждого признака (тип, резьба, длина, стандарт, труба…)
// число на кнопке (core/facets.js по полному списку) = числу позиций, которые сервер отдаёт списку (GET /stock/items?ids=…, как экран).
//   node tools/stock-filter-check.mjs [адрес=http://localhost:3102]   (вход — STAND_LOGIN / STAND_PASSWORD или tools/.night/qa-login.txt)
// Только чтение. Код выхода: 0 — всё сходится, 1 — расхождения, 2 — сбой.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const B = (process.argv[2] || process.env.STAND_URL || 'http://localhost:3102').replace(/\/+$/, '');
const F = await import(pathToFileURL(path.join(ROOT, 'backend/pwa/core/facets.js')).href);
const qaFile = path.join(ROOT, 'tools', '.night', 'qa-login.txt');
const user = process.env.STAND_LOGIN || 'qa';
const pass = process.env.STAND_PASSWORD || (fs.existsSync(qaFile) ? fs.readFileSync(qaFile, 'utf8').trim() : '');
try {
  const L = await (await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) })).json();
  if (!L.access) { console.log(`Вход на ${B} не удался`); process.exit(2); }
  const H = { Authorization: 'Bearer ' + L.access };
  const get = async (q) => (await fetch(B + '/api/stock/items?' + new URLSearchParams(q), { headers: H })).json();
  const items = F.index((await get({ limit: 10000, sort: 'name' })).items || []);
  const cats = [...new Map(items.map((i) => [i.categoryId, i.categoryName])).entries()];
  let ok = 0; const bad = [];
  for (const [cat, cname] of cats) {
    const inCat = F.pick(items, { cat });
    for (const [key, label] of F.FACETS) {
      for (const [v] of F.facetValues(inCat, key)) {
        const ids = F.pick(items, { cat, sel: { [key]: v } }).map((it) => it.id);
        const r = await get({ limit: 1, priority: 1, ids: ids.join(',') || 'none' });
        if (r.total === ids.length) ok++; else bad.push(`${cname} · ${label} «${F.facetLabel(key, v)}»: на кнопке ${ids.length}, в списке ${r.total ?? 'ошибка'}`);
      }
    }
  }
  bad.slice(0, 20).forEach((b) => console.log(b));
  console.log(`Фильтры «Остатков»: проверено ${ok + bad.length}, расхождений ${bad.length}`);
  process.exit(bad.length ? 1 : 0);
} catch (e) { console.log('Сбой проверки: ' + e.message); process.exit(2); }
