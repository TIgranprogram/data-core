// Одинаковые картинки у разных позиций склада (только чтение): скачивает миниатюры по ссылкам из выгрузки
// GET /api/stock/items, считает «отпечаток» (8×8, оттенки серого, aHash) и группирует похожие (≤ 6 бит различий).
// Запуск из backend/: node scripts/photo-dupes.mjs <stock-items.json> <отчёт.md> [https://kppdf-crm.ru/db]
// Пользователь 2026-11-06: «у болтов фотография шайбы». Ничего не меняет; исправление — по отчёту, вручную или скриптом с --apply.
import fs from 'fs';
import sharp from 'sharp';

const [, , src, out, base = 'https://kppdf-crm.ru/db'] = process.argv;
const items = (JSON.parse(fs.readFileSync(src, 'utf8')).items || []).filter((x) => (x.photos || []).length);
const kind = (n) => { const s = String(n || '').toLowerCase(); return ['болт', 'шайба', 'гайка', 'винт', 'шуруп', 'саморез', 'анкер', 'заклепк', 'заклёпк', 'шпилька', 'дюбель', 'хомут', 'диск', 'круг', 'труба', 'лист', 'уголок', 'профиль'].find((k) => s.includes(k)) || ''; };

async function ahash(url) {
  const r = await fetch(base + url);
  if (!r.ok) return null;
  const px = await sharp(Buffer.from(await r.arrayBuffer())).flatten({ background: '#fff' }).greyscale().resize(8, 8, { fit: 'fill' }).raw().toBuffer();
  const avg = px.reduce((a, b) => a + b, 0) / px.length;
  return [...px].map((v) => (v > avg ? '1' : '0')).join('');
}
const dist = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };

const rows = [];
for (const it of items) {
  const p = it.photos[0];
  const h = await ahash(p.thumb || p.url).catch(() => null);
  if (h) rows.push({ id: it.id, name: it.name, cat: it.categoryName, url: p.url, thumb: p.thumb, h, kind: kind(it.name) });
}
const used = new Set(), groups = [];
for (const a of rows) {
  if (used.has(a.id)) continue;
  const g = rows.filter((b) => !used.has(b.id) && dist(a.h, b.h) <= 6);
  if (g.length > 1) { g.forEach((b) => used.add(b.id)); groups.push(g); }
}
const mixed = groups.filter((g) => new Set(g.map((x) => x.kind).filter(Boolean)).size > 1);
const lines = [`# Одинаковые фото у разных позиций склада — ${new Date().toISOString().slice(0, 10)}`, '',
  `Позиций с фото: ${items.length}, проверено: ${rows.length}. Групп одинаковых картинок: ${groups.length}, из них с разными типами (болт ↔ шайба и т. п.): ${mixed.length}.`, '',
  '## ⚠ Разные типы с одной картинкой (скорее всего ошибка)', ''];
for (const g of mixed) { lines.push(`- картинка ${base}${g[0].thumb}`); for (const x of g) lines.push(`  - [${x.cat || '—'}] ${x.name} — \`${x.id}\``); lines.push(''); }
lines.push('## Остальные одинаковые картинки (один тип — может быть нормой, например одна картинка на размерный ряд)', '');
for (const g of groups.filter((g) => !mixed.includes(g))) { lines.push(`- ${g.length} поз.: ${g.slice(0, 6).map((x) => x.name).join(' · ')}${g.length > 6 ? ' …' : ''}`); }
fs.writeFileSync(out, lines.join('\n'));
console.log(`проверено ${rows.length}, групп ${groups.length}, смешанных ${mixed.length} → ${out}`);

// --sheet <файл.png> [фильтр-регэксп по названию]: сетка миниатюр с номерами — глазами видно чужое фото; список номеров — рядом .txt
const si = process.argv.indexOf('--sheet');
if (si > 0) {
  const file = process.argv[si + 1], re = new RegExp(process.argv[si + 2] || '.', 'i');
  const pick = rows.filter((x) => re.test(x.name));
  const C = 10, S = 120, L = 18;
  const tiles = await Promise.all(pick.map(async (x, k) => {
    const buf = Buffer.from(await (await fetch(base + x.thumb)).arrayBuffer());
    const img = await sharp(buf).flatten({ background: '#fff' }).resize(S, S, { fit: 'contain', background: '#fff' }).png().toBuffer();
    const label = Buffer.from(`<svg width="${S}" height="${L}"><rect width="100%" height="100%" fill="#222"/><text x="4" y="13" font-size="12" font-family="Arial" fill="#fff">${k + 1}</text></svg>`);
    return { input: await sharp({ create: { width: S, height: S + L, channels: 3, background: '#fff' } }).composite([{ input: img, top: L, left: 0 }, { input: label, top: 0, left: 0 }]).png().toBuffer(), left: (k % C) * S, top: Math.floor(k / C) * (S + L) };
  }));
  await sharp({ create: { width: C * S, height: Math.ceil(pick.length / C) * (S + L), channels: 3, background: '#fff' } }).composite(tiles).png().toFile(file);
  fs.writeFileSync(file.replace(/\.png$/, '.txt'), pick.map((x, k) => `${k + 1}\t${x.name}\t${x.id}`).join('\n'));
  console.log(`сетка ${pick.length} → ${file}`);
}
