/* ARCH-PLAN М9 (2026-10-23): файлы в uploads, на которые не ссылается база, — ТОЛЬКО СПИСОК, ничего не удаляет.
 * Ссылки: photos.storageUrl (все варианты), organizations.assets[].storageUrl. Удалять — отдельно и только по «да» пользователя.
 *
 * Внутри контейнера backend:  docker cp backend/scripts/orphan-uploads.js datacore-backend:/app/scripts/
 *                             docker exec datacore-backend node scripts/orphan-uploads.js
 */
const path = require('path');
const fs = require('fs/promises');
const root = path.join(__dirname, '..');
const { MongoClient } = require(require.resolve('mongoose', { paths: [root] })).mongo;

(async () => {
  const dir = path.resolve(process.env.UPLOAD_DIR || path.join(root, 'uploads'));
  const client = await MongoClient.connect(process.env.MONGO_URI);
  try {
    const db = client.db();
    const used = new Set();
    for (const p of await db.collection('photos').find({}, { projection: { storageUrl: 1 } }).toArray()) used.add(String(p.storageUrl || '').replace('/uploads/', ''));
    for (const o of await db.collection('organizations').find({ 'assets.0': { $exists: true } }, { projection: { assets: 1 } }).toArray()) for (const a of o.assets || []) used.add(String(a.storageUrl || '').replace('/uploads/', ''));
    const orphans = [];
    for (const name of await fs.readdir(dir)) {
      const st = await fs.stat(path.join(dir, name)).catch(() => null);
      if (st?.isFile() && !used.has(name)) orphans.push({ name, size: st.size });
    }
    orphans.sort((a, b) => b.size - a.size);
    const kb = (n) => `${Math.round(n / 1024)} КБ`;
    console.log(`Файлов без ссылок из базы: ${orphans.length}, ${kb(orphans.reduce((s, f) => s + f.size, 0))} (ничего не удалено)`);
    for (const f of orphans.slice(0, 30)) console.log(`  ${f.name} · ${kb(f.size)}`);
    if (orphans.length > 30) console.log(`  …и ещё ${orphans.length - 30}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
