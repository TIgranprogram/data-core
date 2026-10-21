/* Перенос паспортов из Google-таблицы «Pasports» (TASKS ПС.3). Источник — выгрузка .xlsx (в ней есть картинки
 * общего вида из ячеек Данные!E; Sheets API их не отдаёт). Логика — src/modules/product-passport/passport-import.ts.
 *
 *   Отчёт (по умолчанию, ничего не пишет):
 *     MONGO_URI=… [MONGO_DB=…] node scripts/import-passports.js --file Pasports.xlsx [--decisions файл] [--out-dir папка]
 *     решения пользователя (опечатки, единые категории, поправки, «пустое — из той же модели») — scripts/passports-decisions.json
 *     --download вместо --file: скачать выгрузку по ссылке таблицы (таблица открыта по ссылке)
 *   Запись: … --apply [--backup <папка бэкапа>]  (на базе datacore --backup обязателен — сначала backup.sh)
 *     идемпотентно по passportNumber: новые — вставка; перенесённые раньше (source sheet:Pasports) — обновление
 *     изменившихся полей; созданные в приложении/kppdf — не трогаются (конфликт в отчёт).
 *     Картинки → UPLOAD_DIR (одинаковые — один файл) + photos (оригинал и миниатюра). Файл отката — в out-dir.
 *   Откат: … --rollback <passports-before-….json> [--apply] — по умолчанию тоже только отчёт.
 * Нужна сборка (dist): в контейнере есть; локально — npx nest build. Таблицу «Pasports» скрипт не меняет. */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const req = (m) => require(require.resolve(m, { paths: [process.cwd(), path.join(__dirname, '..')] }));
const { MongoClient, ObjectId } = req('mongoose').mongo;
const dist = (f) => require(path.join(process.cwd(), 'dist', 'src', 'modules', 'product-passport', f));
const { readXlsx } = dist('xlsx-read');
const { planImport } = dist('passport-import');

const SHEET_ID = '1Y8Z4xrleSJXwCIWaNX2agRNAkNmFDpyQgh1QxpYmfmc';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const has = (k) => process.argv.includes(k);
const apply = has('--apply');
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const outDir = arg('--out-dir') || path.join(process.cwd(), `passports-import-${stamp}`);
const csv = (rows) => rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`).join(';')).join('\n');
const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"'.,()\s-]/g, '');
const same = (a, b) => (a instanceof Date || b instanceof Date ? new Date(a).getTime() === new Date(b).getTime() : JSON.stringify(a ?? null) === JSON.stringify(b ?? null));
const FIELDS = ['date', 'warrantyCode', 'productCode', 'productCodeDuplicate', 'article', 'name', 'category', 'height', 'length', 'width', 'weight', 'description', 'materials', 'installationMethod', 'purpose', 'objectName', 'customerName', 'orderNo', 'supplier', 'supplierOrgId', 'productId'];

async function source() {
  if (arg('--file')) return fs.readFileSync(arg('--file'));
  if (!has('--download')) throw new Error('Укажите --file <выгрузка.xlsx> или --download');
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`);
  if (!r.ok) throw new Error(`выгрузка таблицы: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function storeImage(db, buf, sharp, uploadDir) {
  const sha = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20);
  const name = `pp-${sha}.png`;
  const url = `/uploads/${name}`;
  const ex = await db.collection('photos').findOne({ storageUrl: url, variant: 'original' });
  if (ex) return { id: ex._id, created: false };
  const png = await sharp(buf).png().toBuffer();
  fs.writeFileSync(path.join(uploadDir, name), png);
  const now = new Date();
  const meta = await sharp(png).metadata();
  const { insertedId } = await db.collection('photos').insertOne({ storageUrl: url, originalFilename: name, mimeType: 'image/png', sizeBytes: png.length, widthPx: meta.width, heightPx: meta.height, variant: 'original', deletedAt: null, createdAt: now, updatedAt: now });
  const thumbName = `pp-${sha}-t.webp`;
  const out = await sharp(png).resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(uploadDir, thumbName));
  await db.collection('photos').insertOne({ storageUrl: `/uploads/${thumbName}`, originalFilename: name, variant: 'thumb', mimeType: 'image/webp', sizeBytes: out.size, widthPx: out.width, heightPx: out.height, parentPhotoId: insertedId, deletedAt: null, createdAt: now, updatedAt: now });
  return { id: insertedId, created: true };
}

async function rollback(db, file) {
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`Откат по ${file}: вставлено было ${plan.inserted.length}, обновлено ${plan.updated.length} (перенос ${plan.meta.appliedAt}, бэкап ${plan.meta.backup || '—'})`);
  if (!apply) { console.log('dry-run — ничего не изменено'); return; }
  const del = await db.collection('productpassports').deleteMany({ _id: { $in: plan.inserted.map((id) => new ObjectId(id)) }, source: 'sheet:Pasports' });
  let restored = 0;
  for (const b of plan.updated) { const { _id, ...rest } = b; await db.collection('productpassports').replaceOne({ _id: new ObjectId(_id) }, { ...rest, date: rest.date ? new Date(rest.date) : rest.date }); restored++; }
  console.log(`Удалено вставленных: ${del.deletedCount}; возвращено прежних: ${restored}`);
}

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const client = await MongoClient.connect(uri);
  const db = client.db(process.env.MONGO_DB || undefined);
  if (has('--rollback')) { await rollback(db, arg('--rollback')); return client.close(); }
  if (apply && db.databaseName === 'datacore' && !arg('--backup')) throw new Error('На рабочей базе datacore запись только с --backup <папка> (сначала backup.sh)');

  const book = readXlsx(await source());
  const data = book.sheets.get('Данные'), photos = book.sheets.get('Фотографии');
  if (!data) throw new Error('В выгрузке нет листа «Данные»');
  const ours = await db.collection('organizations').find({ isOurCompany: true, deletedAt: null }, { projection: { name: 1, shortName: 1 } }).toArray();
  // решения пользователя (опечатки, категории, поправки по паспортам) — scripts/passports-decisions.json; --decisions <файл> — другой
  const decFile = arg('--decisions') || path.join(__dirname, 'passports-decisions.json');
  const dec = has('--no-decisions') || !fs.existsSync(decFile) ? {} : JSON.parse(fs.readFileSync(decFile, 'utf8'));
  const dict = { ...(dec.typos || {}), ...(arg('--dict') ? JSON.parse(fs.readFileSync(arg('--dict'), 'utf8')) : {}) };
  const plan = planImport(data, photos, { dict, categories: dec.categories, overrides: dec.overrides, fillFromModel: !!dec.fillFromModel, ourCompanies: ours.map((o) => ({ id: String(o._id), name: o.name, shortName: o.shortName })) });

  // модели из каталога: по артикулу (sku) или названию
  const products = await db.collection('products').find({ deletedAt: null }, { projection: { sku: 1, name: 1 } }).toArray();
  const bySku = new Map(products.map((p) => [norm(p.sku), p])), byName = new Map(products.filter((p) => p.name).map((p) => [norm(p.name), p]));
  const models = new Map();
  for (const it of plan.items) {
    const p = (it.doc.article && bySku.get(norm(it.doc.article))) || (it.doc.name && byName.get(norm(it.doc.name)));
    if (p) it.doc.productId = p._id;
    const k = `${it.doc.article || ''}|${it.doc.name || ''}`;
    const m = models.get(k) || { article: it.doc.article || '', name: it.doc.name || '', product: p ? `${p.sku} · ${p.name || ''}` : '', nos: [] };
    m.nos.push(it.no); models.set(k, m);
  }

  // сравнение с базой
  const existing = new Map((await db.collection('productpassports').find({ passportNumber: { $in: plan.items.map((i) => i.no) } }).toArray()).map((d) => [d.passportNumber, d]));
  const toInsert = [], toUpdate = [], conflicts = [], same0 = [];
  for (const it of plan.items) {
    const ex = existing.get(it.no);
    if (!ex) { toInsert.push(it); continue; }
    if (ex.source !== 'sheet:Pasports') { conflicts.push({ it, ex }); continue; }
    const set = {};
    for (const f of FIELDS) if (it.doc[f] !== undefined && !same(String(ex[f] ?? ''), String(it.doc[f]))) set[f] = it.doc[f];
    if (Object.keys(set).length) toUpdate.push({ it, ex, set }); else same0.push(it);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'changes.csv'), '﻿' + csv([['паспорт', 'поле', 'было', 'стало', 'причина'], ...plan.changes.map((c) => [c.no, c.field, c.before, c.after, c.reason])]));
  fs.writeFileSync(path.join(outDir, 'decisions.csv'), '﻿' + csv([['паспорт(а)', 'тема', 'что решить'], ...plan.decisions.map((d) => [d.no, d.topic, d.text])]));
  fs.writeFileSync(path.join(outDir, 'objects.csv'), '﻿' + csv([['Объект (как в таблице)', 'тип', 'заказчик', '№ заказа', 'адрес/объект', 'примечание', 'паспортов', '№'], ...plan.objects.map((o) => [o.raw, o.kind, o.customerName, o.orderNo, o.objectName, o.note, o.count, o.nos.join(', ')])]));
  fs.writeFileSync(path.join(outDir, 'models.csv'), '﻿' + csv([['артикул', 'наименование', 'изделие в каталоге', 'паспортов', '№'], ...[...models.values()].map((m) => [m.article, m.name, m.product, m.nos.length, m.nos.join(', ')])]));
  const imgCount = plan.items.reduce((n, i) => n + i.images.length, 0);
  const summary = [
    `База: ${db.databaseName}. Строк в таблице: ${plan.items.length} (№${plan.items[0]?.no}–${plan.items.at(-1)?.no}). Картинок: ${imgCount} (общий вид ${plan.items.filter((i) => i.images.some((x) => x.kind === 'overview')).length}).`,
    `Новых: ${toInsert.length}; обновить: ${toUpdate.length}; без изменений: ${same0.length}; конфликт (паспорт уже создан не переносом): ${conflicts.length}${conflicts.length ? ' — ' + conflicts.map((c) => c.it.no).join(', ') : ''}.`,
    `Изменений текста/чисел при чистке: ${plan.changes.length}; на решение: ${plan.decisions.length}; разных «Объектов»: ${plan.objects.length}; моделей: ${models.size} (найдено в каталоге: ${[...models.values()].filter((m) => m.product).length}).`,
    `Наши компании: ${ours.map((o) => o.name).join(', ') || '—'}; паспортов с поставщиком-организацией: ${plan.items.filter((i) => i.doc.supplierOrgId).length}.`,
    `Отчёты: ${outDir} (changes.csv, decisions.csv, objects.csv, models.csv).`,
  ];
  fs.writeFileSync(path.join(outDir, 'summary.txt'), summary.join('\n'));
  console.log(summary.join('\n'));
  if (!apply) { console.log('dry-run — ничего не изменено'); return client.close(); }

  // запись
  const sharp = req('sharp');
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const rb = { meta: { appliedAt: new Date().toISOString(), db: db.databaseName, backup: arg('--backup') || null }, inserted: [], updated: toUpdate.map((u) => ({ ...u.ex, _id: String(u.ex._id) })) };
  const rbFile = path.join(outDir, `passports-before-${stamp}.json`);
  fs.writeFileSync(rbFile, JSON.stringify(rb, null, 1)); // до записи — откат обновлений
  let newPhotos = 0;
  const images = async (it) => {
    const out = [];
    for (const [k, im] of it.images.entries()) {
      const buf = book.media.get(im.media);
      if (!buf) continue;
      const r = await storeImage(db, buf, sharp, uploadDir);
      if (r.created) newPhotos++;
      out.push({ kind: im.kind, photoId: r.id, order: k, ...(im.caption ? { caption: im.caption } : {}) });
    }
    return out;
  };
  const now = new Date();
  for (const it of toInsert) {
    const doc = { ...it.doc, images: await images(it), isActive: true, deletedAt: null, createdAt: now, updatedAt: now };
    if (doc.supplierOrgId) doc.supplierOrgId = new ObjectId(String(doc.supplierOrgId));
    const { insertedId } = await db.collection('productpassports').insertOne(doc);
    rb.inserted.push(String(insertedId));
    fs.writeFileSync(rbFile, JSON.stringify(rb, null, 1));
  }
  for (const u of toUpdate) {
    const set = { ...u.set, updatedAt: now };
    if (set.supplierOrgId) set.supplierOrgId = new ObjectId(String(set.supplierOrgId));
    if (!(u.ex.images || []).length && u.it.images.length) set.images = await images(u.it);
    await db.collection('productpassports').updateOne({ _id: u.ex._id, source: 'sheet:Pasports' }, { $set: set });
  }
  await db.collection('auditlogs').insertOne({ action: 'passport.imported', entityType: 'ProductPassport', userName: 'система', details: { inserted: rb.inserted.length, updated: toUpdate.length, photos: newPhotos, backup: rb.meta.backup, rollback: path.basename(rbFile) }, createdAt: now, updatedAt: now });
  console.log(`Записано: новых ${rb.inserted.length}, обновлено ${toUpdate.length}, картинок новых ${newPhotos}. Откат: --rollback ${rbFile}`);
  await client.close();
})().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
