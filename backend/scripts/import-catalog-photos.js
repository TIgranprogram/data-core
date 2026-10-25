/* Каталог СпортИН-ЮГ → «Продукция»: 25 групп (3 раздела → группы с номером) и изделия С ФОТО (остальные не переносим).
 * Артикул = номер группы + 2 цифры (как в каталоге). Артикул уже есть в базе (в т. ч. в корзине) — изделие не трогаем.
 * Счётчик автоартикула (ProductSku) каждой группы поднимается до максимума по каталогу — иначе автоартикул выдал бы занятый.
 *
 * Нужен собранный dist (npx nest build) и sharp. Запуск (из backend/):
 *   MONGO_URI=… MONGO_DB=datacore-test UPLOAD_DIR=./uploads node scripts/import-catalog-photos.js [путь/к/каталогу] [--apply]
 * Каталог по умолчанию — «для анализа/каталог-2026-10-25» (catalog.json + photos/<артикул>.png).
 * План по умолчанию — ничего не пишет. С --apply пишет и сохраняет файл отката
 * (import-catalog-photos-rollback-<время>.json: созданные изделия, фото, категории, файлы, прежние значения счётчиков и groupNo).
 * ТОЛЬКО на тестовой БД; на datacore (прод) — по решению пользователя, после бэкапа.
 */
const path = require('path');
const fs = require('fs/promises');
const { createHash, randomUUID } = require('crypto');
const root = path.join(__dirname, '..');
const lib = (m) => require(require.resolve(m, { paths: [root] }));
const { MongoClient } = lib('mongoose').mongo;
const sharp = lib('sharp');
const { skuRegex } = require(path.join(root, 'dist/src/common/text/search-norm'));
const { shrinkInPlace } = require(path.join(root, 'dist/src/modules/photos/image-shrink'));

const SKU_ENTITY = 'ProductSku'; // как в showcase-sku.ts
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameRe = (n) => new RegExp('^\\s*' + esc(clean(n)).replace(/ /g, '\\s+') + '\\s*$', 'i');

/** slug и skuPrefix уникальны в общей схеме categories — формула та же, что в ShowcaseService.category() */
const catDoc = (name, parentId, groupNo) => {
  const h = createHash('md5').update(`${parentId ?? ''}/${name.toLowerCase()}`).digest('hex').slice(0, 8);
  const now = new Date();
  return { name, slug: `product-${h}`, type: 'product', parentId: parentId ?? null, skuPrefix: `PR${h.toUpperCase()}`, sortOrder: 0, isActive: true, deletedAt: null, ...(groupNo ? { groupNo } : {}), createdAt: now, updatedAt: now };
};

(async () => {
  const apply = process.argv.includes('--apply');
  const dir = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(root, '..', 'для анализа', 'каталог-2026-10-25'));
  const cat = JSON.parse(await fs.readFile(path.join(dir, 'catalog.json'), 'utf8'));
  const upDir = path.resolve(process.env.UPLOAD_DIR || path.join(root, 'uploads'));
  const client = await MongoClient.connect(process.env.MONGO_URI);
  const db = client.db(process.env.MONGO_DB || undefined);
  const problems = [];
  try {
    if (apply && /^datacore$/.test(db.databaseName) && process.env.ALLOW_PROD !== '1') throw new Error('Запись в «datacore» запрещена без решения пользователя (ALLOW_PROD=1). Тест — на datacore-test.');
    const all = [...cat.items, ...cat.emptyGroups];
    const withPhoto = cat.items.filter((i) => i.photo);

    // ── 1. Категории: разделы и группы
    const sections = new Map(); // имя → { doc|null, id }
    const groups = new Map();   // groupNo → { type, name, no, doc|null, action }
    const cats = db.collection('categories');
    for (const type of [...new Set(all.map((g) => g.type))]) {
      const doc = await cats.findOne({ type: 'product', deletedAt: null, parentId: null, name: nameRe(type) });
      sections.set(type, { name: type, id: doc?._id ?? null, exists: !!doc });
    }
    for (const g of all) {
      if (groups.has(g.groupNo)) continue;
      const sec = sections.get(g.type);
      const found = sec.id ? await cats.findOne({ type: 'product', deletedAt: null, parentId: sec.id, name: nameRe(g.groupName) }) : null;
      const sameNo = await cats.findOne({ type: 'product', deletedAt: null, groupNo: g.groupNo });
      if (sameNo && (!found || String(sameNo._id) !== String(found._id))) problems.push(`Номер группы ${g.groupNo} уже у другой категории «${sameNo.name}» — «${g.groupName}» не создаём`);
      if (found?.groupNo && String(found.groupNo) !== g.groupNo) problems.push(`Группа «${g.groupName}» уже имеет номер ${found.groupNo}, в каталоге ${g.groupNo}`);
      groups.set(g.groupNo, { type: g.type, name: g.groupName, no: g.groupNo, id: found?._id ?? null, action: !found ? 'создать' : found.groupNo ? 'есть' : 'дописать номер' });
    }
    // группа с таким же именем в другом разделе — просто предупреждение (не склеиваем разделы)
    for (const g of groups.values()) {
      if (g.id) continue;
      const other = await cats.findOne({ type: 'product', deletedAt: null, parentId: { $ne: null }, name: nameRe(g.name) });
      if (other) console.log(`  ! группа «${g.name}» уже есть в другом разделе (id ${other._id}) — будет создана новая в «${g.type}»`);
    }

    // ── 2. Изделия
    const seen = new Set();
    const items = [];
    for (const i of withPhoto) {
      const sku = clean(i.sku);
      const photoPath = path.join(dir, 'photos', i.photo);
      const hasFile = await fs.stat(photoPath).then((s) => s.isFile()).catch(() => false);
      if (!hasFile) problems.push(`Нет файла фото ${i.photo} (артикул ${sku})`);
      if (!/^\d{4}$/.test(sku) || sku.slice(0, 2) !== String(i.groupNo)) problems.push(`Артикул ${sku} не по шаблону группы ${i.groupNo}`);
      if (seen.has(sku)) problems.push(`Артикул ${sku} в каталоге дважды`);
      seen.add(sku);
      const dup = await db.collection('products').findOne({ sku: skuRegex(sku) }, { projection: { sku: 1, name: 1, deletedAt: 1 } });
      items.push({ ...i, sku, photoPath, dup, action: dup ? 'уже есть' : 'создать' });
    }

    // ── 3. Счётчики: максимум номера по ВСЕМ изделиям каталога (в т. ч. без фото — их артикулы зарезервированы)
    const maxSeq = new Map();
    for (const i of cat.items) if (/^\d{4}$/.test(clean(i.sku))) maxSeq.set(i.groupNo, Math.max(maxSeq.get(i.groupNo) ?? 0, Number(clean(i.sku).slice(2))));

    // ── План
    const cnt = (arr, a) => arr.filter((x) => x.action === a).length;
    console.log(`${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'} · БД ${db.databaseName} · каталог ${dir}`);
    console.log(`Разделы: создать ${[...sections.values()].filter((s) => !s.exists).length}, есть ${[...sections.values()].filter((s) => s.exists).length}`);
    const gl = [...groups.values()];
    console.log(`Группы (${gl.length}): создать ${cnt(gl, 'создать')}, дописать номер ${cnt(gl, 'дописать номер')}, уже есть ${cnt(gl, 'есть')}`);
    for (const g of gl.sort((a, b) => a.no.localeCompare(b.no))) console.log(`  ${g.no} · ${g.name} · ${g.type} · ${g.action} · счётчик ≥ ${maxSeq.get(g.no) ?? 0}`);
    console.log(`Изделия с фото: ${items.length} — создать ${cnt(items, 'создать')}, пропустить (артикул уже есть) ${cnt(items, 'уже есть')}`);
    for (const i of items.filter((x) => x.dup)) console.log(`  = ${i.sku} «${i.name}» ↔ в базе «${i.dup.name ?? ''}»${i.dup.deletedAt ? ' (в корзине)' : ''}`);
    if (problems.length) { console.log('ПРОБЛЕМЫ (запись невозможна):'); problems.forEach((p) => console.log('  - ' + p)); }
    if (!apply) return;
    if (problems.length) throw new Error('Есть проблемы — запись отменена');

    // ── Запись
    const rb = { db: db.databaseName, at: new Date().toISOString(), createdCategories: [], groupNoSet: [], createdProducts: [], createdPhotos: [], files: [], counters: [] };
    const rbFile = path.resolve(`import-catalog-photos-rollback-${Date.now()}.json`);
    const save = () => fs.writeFile(rbFile, JSON.stringify(rb, null, 1));
    try {
      for (const s of sections.values()) if (!s.id) { const d = catDoc(s.name, null); s.id = (await cats.insertOne(d)).insertedId; rb.createdCategories.push(String(s.id)); }
      for (const g of gl) {
        const pid = sections.get(g.type).id;
        if (!g.id) { g.id = (await cats.insertOne(catDoc(g.name, pid, g.no))).insertedId; rb.createdCategories.push(String(g.id)); }
        else if (g.action === 'дописать номер') { await cats.updateOne({ _id: g.id }, { $set: { groupNo: g.no, updatedAt: new Date() } }); rb.groupNoSet.push(String(g.id)); }
      }
      for (const g of gl) {
        const col = db.collection('counters'); const key = { entity: SKU_ENTITY, prefix: g.no, year: 0 };
        const prev = await col.findOne(key);
        await col.updateOne(key, { $max: { seq: maxSeq.get(g.no) ?? 0 } }, { upsert: true });
        rb.counters.push({ prefix: g.no, prevSeq: prev ? prev.seq : null }); // null — документа не было (при откате удалить)
      }
      for (const i of items.filter((x) => !x.dup)) {
        // фото — как POST /photos/upload: файл в UPLOAD_DIR, original + thumb 320 px webp
        const fname = `${randomUUID()}.png`; const dest = path.join(upDir, fname);
        await fs.copyFile(i.photoPath, dest); rb.files.push(dest);
        const size = (await fs.stat(dest)).size;
        const shrunk = await shrinkInPlace(dest, 'image/png', size);
        const now = new Date(); const frame = { fit: 'contain', posX: 50, posY: 50 };
        const original = (await db.collection('photos').insertOne({ storageUrl: `/uploads/${fname}`, originalFilename: i.photo, variant: 'original', mimeType: 'image/png', sizeBytes: shrunk ?? size, frame, createdAt: now, updatedAt: now })).insertedId;
        rb.createdPhotos.push(String(original));
        const tname = `${randomUUID()}.webp`; const tpath = path.join(upDir, tname);
        const out = await sharp(dest).rotate().resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(tpath);
        rb.files.push(tpath);
        const thumb = (await db.collection('photos').insertOne({ storageUrl: `/uploads/${tname}`, originalFilename: i.photo, variant: 'thumb', mimeType: 'image/webp', sizeBytes: out.size, widthPx: out.width, heightPx: out.height, parentPhotoId: original, frame, createdAt: now, updatedAt: now })).insertedId;
        rb.createdPhotos.push(String(thumb));
        // поля — как ShowcaseService.create()
        const pid = (await db.collection('products').insertOne({ sku: i.sku, kind: 'good', unit: 'шт', status: 'draft', listPrice: 0, basePrice: 0, costPrice: 0, defaultMarkupPercent: 30, stockQty: 0,
          photoIds: [original], mainPhotoId: original, productModuleIds: [], composition: [], isActive: true, deletedAt: null, hasPassport: false, hasDrawing: false,
          name: clean(i.name) || i.sku, series: clean(i.series) || null, categoryId: groups.get(i.groupNo).id, source: 'showcase', createdAt: now, updatedAt: now })).insertedId;
        rb.createdProducts.push(String(pid));
        await save();
      }
    } finally { await save(); }
    console.log(`ГОТОВО: категорий создано ${rb.createdCategories.length}, номеров групп дописано ${rb.groupNoSet.length}, изделий ${rb.createdProducts.length}, файлов ${rb.files.length}. Откат: ${rbFile}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
