/* ARCH-PLAN М9 (2026-10-23): файлы в uploads, на которые не ссылается база. Без --apply — ТОЛЬКО СПИСОК.
 * Ссылки: photos.storageUrl (все варианты), organizations.assets[].storageUrl.
 * --apply (Т-7, «да» пользователя 2026-10-23; бэкап uploads перед — deploy/synology/backup.sh): перед удалением имя
 * каждого файла ищется во ВСЕХ таблицах базы — встретилось где-то ещё → файл не трогаем.
 *
 * Внутри контейнера backend:  docker cp backend/scripts/orphan-uploads.js datacore-backend:/app/scripts/
 *                             docker exec datacore-backend node scripts/orphan-uploads.js [--apply]
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
    const apply = process.argv.includes('--apply');
    console.log(`Файлов без ссылок из базы: ${orphans.length}, ${kb(orphans.reduce((s, f) => s + f.size, 0))}${apply ? '' : ' (ничего не удалено)'}`);
    for (const f of orphans.slice(0, 30)) console.log(`  ${f.name} · ${kb(f.size)}`);
    if (orphans.length > 30) console.log(`  …и ещё ${orphans.length - 30}`);
    if (apply && orphans.length) {
      // вторая проверка: имя файла не встречается ни в одной таблице (на случай ссылок мимо photos / assets)
      const seen = new Set();
      for (const { name } of await db.listCollections().toArray()) {
        if (name.startsWith('system.')) continue;
        for (const d of await db.collection(name).find({}).toArray()) { const s = JSON.stringify(d); for (const f of orphans) if (s.includes(f.name)) seen.add(f.name); }
      }
      let removed = 0;
      for (const f of orphans) {
        if (seen.has(f.name)) { console.log(`  оставлен (есть упоминание в базе): ${f.name}`); continue; }
        await fs.unlink(path.join(dir, f.name)); removed++;
      }
      console.log(`Удалено: ${removed}`);
    }
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
