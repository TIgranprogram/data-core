/* Скорость С2 (2026-10-22): облегчить уже загруженные тяжёлые картинки на месте — имя файла и ссылки не меняются.
 * Печать/подпись/логотип наших компаний (organizations.assets) — как при новой загрузке: ≤ 800 px, PNG с палитрой.
 * Остальные картинки > 500 КБ — как новые фото: ≤ 2560 px, тот же формат (shrinkInPlace). Размер в базе обновляется.
 *
 * Запуск — внутри контейнера backend (нужен собранный dist), после бэкапа uploads:
 *   docker cp backend/scripts/shrink-uploads.js datacore-backend:/app/scripts/
 *   План (ничего не меняет):  docker exec datacore-backend node scripts/shrink-uploads.js
 *   Записать:                 docker exec datacore-backend node scripts/shrink-uploads.js --apply
 */
const path = require('path');
const fs = require('fs/promises');
const root = path.join(__dirname, '..');
const { MongoClient } = require(require.resolve('mongoose', { paths: [root] })).mongo;
const { normalizeAssetImage } = require(path.join(root, 'dist/src/modules/organization/asset-image'));
const { shrinkInPlace } = require(path.join(root, 'dist/src/modules/photos/image-shrink'));

const MIN = 500 * 1024;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif' };
const kb = (n) => `${Math.round(n / 1024)} КБ`;

(async () => {
  const apply = process.argv.includes('--apply');
  const dir = path.resolve(process.env.UPLOAD_DIR || path.join(root, 'uploads'));
  const client = await MongoClient.connect(process.env.MONGO_URI);
  const db = client.db();
  try {
    const orgs = await db.collection('organizations').find({ 'assets.0': { $exists: true } }, { projection: { name: 1, assets: 1 } }).toArray();
    const assetFiles = new Map(orgs.flatMap((o) => (o.assets || []).map((a) => [String(a.storageUrl).replace('/uploads/', ''), { org: o, asset: a }])));
    const files = [];
    for (const name of await fs.readdir(dir)) {
      const st = await fs.stat(path.join(dir, name)).catch(() => null);
      if (st?.isFile() && st.size > MIN && MIME[path.extname(name).toLowerCase()]) files.push({ name, size: st.size });
    }
    console.log(`${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}: файлов > 500 КБ — ${files.length} (${kb(files.reduce((s, f) => s + f.size, 0))})`);
    let saved = 0;
    for (const f of files) {
      const full = path.join(dir, f.name);
      const a = assetFiles.get(f.name);
      if (!apply) { console.log(`  ${f.name} · ${kb(f.size)} · ${a ? `${a.asset.role} «${a.org.name}»` : 'картинка'}`); continue; }
      let size = null;
      if (a) {
        const out = await normalizeAssetImage(await fs.readFile(full)).catch(() => null);
        if (out && out.data.length < f.size) { await fs.writeFile(full, out.data); size = out.data.length; }
        if (size) await db.collection('organizations').updateOne({ _id: a.org._id, 'assets.storageUrl': a.asset.storageUrl }, { $set: { 'assets.$.sizeBytes': size } });
      } else {
        size = await shrinkInPlace(full, MIME[path.extname(f.name).toLowerCase()], f.size);
      }
      if (size) {
        await db.collection('photos').updateMany({ storageUrl: '/uploads/' + f.name }, { $set: { sizeBytes: size } });
        saved += f.size - size;
        console.log(`  ${f.name}: ${kb(f.size)} → ${kb(size)}`);
      } else console.log(`  ${f.name}: без изменений`);
    }
    if (apply) console.log(`Готово: освобождено ${kb(saved)}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
