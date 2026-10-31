/* SPEED-2 п.2: старые фото — сжать оригинал и дозаполнить thumb/medium теми же правилами, что при загрузке
 * (src/modules/photos/image-shrink.ts + photos.service.ts: оригинал ≤ 2560 px / 3 МБ; thumb 320 px и medium 1000 px, webp q80).
 * Берёт originals-картинки (не PDF/GIF), у которых нет thumb или medium, либо файл тяжёлый. Уже готовое не трогает (можно запускать повторно).
 * Без --apply — ТОЛЬКО ПЛАН: сколько фото, сколько МБ сэкономит, первые 10 путей.
 * --apply — пачками по 20; новый файл пишется во временный и подменяет оригинал только после успеха; файлы вариантов
 * пишутся до записи в photos; сбой одного фото не останавливает остальные. Бэкап uploads перед — deploy/synology/backup.sh.
 * --limit N — только первые N фото (проба).
 * Внутри контейнера backend:  docker cp backend/scripts/photos-compress-old.js datacore-backend:/app/scripts/
 *                             docker exec datacore-backend node scripts/photos-compress-old.js [--apply] [--limit N]
 */
const path = require('path');
const fs = require('fs/promises');
const { randomUUID } = require('crypto');
const root = path.join(__dirname, '..');
const sharp = require(require.resolve('sharp', { paths: [root] }));
const { MongoClient } = require(require.resolve('mongoose', { paths: [root] })).mongo;

const MAX_SIDE = 2560, MAX_BYTES = 3 * 1024 * 1024, BATCH = 20;
const VARIANTS = [{ variant: 'thumb', side: 320, suffix: '.webp' }, { variant: 'medium', side: 1000, suffix: '-medium.webp' }];
const mb = (n) => (n / 1048576).toFixed(1);

/** Те же настройки, что shrinkInPlace; возвращает буфер или null, если облегчать не нужно / не помогло. */
async function shrunkBuffer(raw, mime, size) {
  if (mime === 'image/gif') return null;
  const meta = await sharp(raw).metadata();
  const side = Math.max(meta.width || 0, meta.height || 0);
  if (side <= MAX_SIDE && size <= MAX_BYTES) return null;
  let p = sharp(raw).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true });
  if (mime === 'image/png') p = p.png({ compressionLevel: 9, effort: 8 });
  else if (mime === 'image/webp') p = p.webp({ quality: 85 });
  else if (mime === 'image/avif') p = p.avif({ quality: 60 });
  else p = p.jpeg({ quality: 85, mozjpeg: true });
  const data = await p.toBuffer();
  return data.length >= size && side <= MAX_SIDE ? null : data;
}

(async () => {
  const apply = process.argv.includes('--apply');
  const li = process.argv.indexOf('--limit');
  const limit = li > 0 ? parseInt(process.argv[li + 1], 10) : 0;
  const dir = path.resolve(process.env.UPLOAD_DIR || path.join(root, 'uploads'));
  const client = await MongoClient.connect(process.env.MONGO_URI);
  try {
    const col = client.db().collection('photos');
    const kids = new Map(); // parentId -> Set(variant)
    for (const k of await col.find({ variant: { $in: ['thumb', 'medium'] }, deletedAt: null }, { projection: { parentPhotoId: 1, linkedPhotoId: 1, variant: 1 } }).toArray()) {
      const pid = String(k.parentPhotoId || k.linkedPhotoId || '');
      if (!kids.has(pid)) kids.set(pid, new Set());
      kids.get(pid).add(k.variant);
    }
    const originals = await col.find({ variant: 'original', deletedAt: null, mimeType: /^image\//, storageUrl: /^\/uploads\// }).sort({ _id: 1 }).toArray();
    const todo = [];
    let missing = 0;
    for (const o of originals) {
      if (limit && todo.length >= limit) break;
      const file = path.resolve(dir, o.storageUrl.slice('/uploads/'.length));
      if (path.relative(dir, file).startsWith('..')) continue;
      const st = await fs.stat(file).catch(() => null);
      if (!st) { missing++; continue; }
      const have = kids.get(String(o._id)) || new Set();
      const need = VARIANTS.filter((v) => !have.has(v.variant));
      let newSize = null;
      if (o.mimeType !== 'image/gif') {
        try { const b = await shrunkBuffer(await fs.readFile(file), o.mimeType, st.size); if (b) newSize = b.length; } catch { /* битый файл — пропустим при записи */ }
      }
      if (need.length || newSize !== null) todo.push({ o, file, size: st.size, need, newSize });
    }
    const saved = todo.reduce((s, t) => s + (t.newSize !== null ? t.size - t.newSize : 0), 0);
    console.log(`Фото-оригиналов: ${originals.length}; к обработке: ${todo.length}${limit ? ` (--limit ${limit})` : ''}; файла нет на диске: ${missing}`);
    console.log(`  сжать оригинал: ${todo.filter((t) => t.newSize !== null).length}, сэкономит ≈ ${mb(saved)} МБ`);
    console.log(`  без thumb: ${todo.filter((t) => t.need.some((v) => v.variant === 'thumb')).length}, без medium: ${todo.filter((t) => t.need.some((v) => v.variant === 'medium')).length}`);
    if (!apply) {
      for (const t of todo.slice(0, 10)) console.log(`  ${t.o.storageUrl} · ${mb(t.size)} МБ${t.newSize !== null ? ` → ${mb(t.newSize)} МБ` : ''} · добавить: ${t.need.map((v) => v.variant).join(', ') || '—'}`);
      if (todo.length > 10) console.log(`  …и ещё ${todo.length - 10}`);
      console.log('Ничего не изменено. Записать: --apply');
      return;
    }
    let done = 0, failed = 0, freed = 0, added = 0;
    for (let i = 0; i < todo.length; i += BATCH) {
      for (const t of todo.slice(i, i + BATCH)) {
        const made = [];
        try {
          const raw = await fs.readFile(t.file);
          const set = {};
          const data = t.newSize !== null ? await shrunkBuffer(raw, t.o.mimeType, t.size) : null;
          if (data) { // сначала временный файл, подмена — только после успешной записи
            const tmp = `${t.file}.${randomUUID()}.tmp`;
            await fs.writeFile(tmp, data);
            await fs.rename(tmp, t.file);
            set.sizeBytes = data.length;
            freed += t.size - data.length;
          }
          for (const v of t.need) {
            const name = `${randomUUID()}${v.suffix}`;
            const out = path.join(dir, name);
            const r = await sharp(data || raw).rotate().resize({ width: v.side, height: v.side, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(out);
            made.push(out);
            const now = new Date();
            await col.insertOne({
              storageUrl: `/uploads/${name}`, originalFilename: t.o.originalFilename, variant: v.variant, mimeType: 'image/webp',
              sizeBytes: r.size, widthPx: r.width, heightPx: r.height, parentPhotoId: t.o._id, deletedAt: null, createdAt: now, updatedAt: now, __v: 0,
            });
            made.pop(); added++; // файл уже в базе — при сбое дальше его не удаляем
          }
          if (Object.keys(set).length) await col.updateOne({ _id: t.o._id }, { $set: { ...set, updatedAt: new Date() } });
          done++;
        } catch (e) {
          failed++;
          for (const f of made) await fs.unlink(f).catch(() => undefined);
          console.log(`  пропущено ${t.o.storageUrl}: ${e.message}`);
        }
      }
      console.log(`  обработано ${Math.min(i + BATCH, todo.length)} из ${todo.length}`);
    }
    console.log(`Готово: фото ${done}, ошибок ${failed}, добавлено вариантов ${added}, освобождено ≈ ${mb(freed)} МБ`);
  } finally {
    await client.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
