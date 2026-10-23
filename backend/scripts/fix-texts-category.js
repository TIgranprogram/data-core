/* ПК (2026-10-23, «да» пользователя): из общих текстов паспортов («Для всех», «Воркаут») убраны оговорки про детские
 * площадки — детское только в детских категориях (DIO, DSP). Новая версия текстов категории — через тот же API, что
 * редактор «Разделы и тексты» (PUT /passports/texts); прежние версии остаются. Выданные паспорта (textSnapshot) НЕ трогаем.
 * Запуск внутри контейнера backend (нужен JWT_SECRET и пользователь admin — токен не печатается):
 *   node scripts/fix-texts-category.js          — план
 *   node scripts/fix-texts-category.js --apply  — записать
 */
const crypto = require('crypto');
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
const APPLY = process.argv.includes('--apply');
const R = [
  { cat: 'ALL', from: 'Вокруг изделия оставляют свободное пространство (зону безопасности, для детского игрового оборудования — зону приземления); его размеры', to: 'Вокруг изделия оставляют свободное пространство (зону безопасности); его размеры' },
  { cat: 'WRK', from: ' При размещении на детской спортивной площадке оборудование применяют с учётом {std:GOST_R_55677} и {std:GOST_R_55678}.', to: '' },
  { cat: 'WRK', from: '; на детской спортивной площадке — также с учётом {std:GOST_R_55679}.', to: '.' },
];
const CHILD = /детск|ребён|игров/i;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URI); const db = c.db(process.env.MONGO_DB || undefined);
  const u = await db.collection('users').findOne({ role: 'admin', isActive: { $ne: false } });
  await c.close();
  const now = Math.floor(Date.now() / 1000); const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: String(u._id), username: u.username, role: u.role, version: u.refreshTokenVersion ?? 0, orgId: u.organizationId ? String(u.organizationId) : null, iat: now, exp: now + 300 });
  const token = `${head}.${body}.${crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
  const api = async (p, o = {}) => { const r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api${p}`, { ...o, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }); if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`); return r.json(); };
  console.log(APPLY ? 'ЗАПИСЬ' : 'ПЛАН (ничего не пишем)');
  for (const cat of ['ALL', 'TRN', 'WRK', 'MAF']) {
    const t = await api(`/passports/texts?category=${cat}`);
    const sections = JSON.parse(JSON.stringify(t.own?.sections || []));
    let changed = 0;
    for (const r of R.filter((x) => x.cat === cat)) {
      let hit = false;
      for (const s of sections) s.paragraphs = (s.paragraphs || []).map((p) => { if (p.includes(r.from)) { hit = true; return p.replace(r.from, r.to); } return p; });
      console.log(`  ${cat}: ${hit ? 'заменить' : 'не найдено (текст правили вручную?)'} — «${r.from.trim().slice(0, 70)}…»`);
      if (hit) changed++;
    }
    const left = sections.flatMap((s) => (s.paragraphs || []).filter((p) => CHILD.test(p)).map((p) => `${s.title}: ${p.slice(0, 90)}`));
    if (left.length) console.log(`  ${cat}: ещё про детское — ${left.length}:\n    ` + left.join('\n    '));
    if (APPLY && changed) { const res = await api('/passports/texts', { method: 'PUT', body: JSON.stringify({ category: cat, sections }) }); console.log(`  ${cat}: записана версия ${res.version ?? res.own?.version}`); }
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
