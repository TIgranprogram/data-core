/* Импорт заказ-нарядов из Excel (TASKS З.3): один файл .xlsx = один заказ → шапка в salesorders, позиции в incomes.
 *
 * По умолчанию — ТОЛЬКО ОТЧЁТ (dry-run): сколько заказов и позиций, какие файлы слились, подозрительные даты,
 * неизвестная компания. Ничего не пишет. Запись — флаг --apply (на живой базе — только после «да» пользователя и бэкапа).
 *
 *   MONGO_URI='mongodb://user:pw@host:port/db?authSource=admin&directConnection=true' \
 *   [MONGO_DB=datacoreqa] node scripts/import-orders-xlsx.js "<папка с .xlsx>" [--apply]
 *
 * Правила (менять синхронно с src/modules/salesorders/order-key.ts):
 *  - ключ заказа «компания|номер»: номер без «№», пробелы схлопнуты, верхний регистр («СИЮ|110-П»);
 *    два файла с одним ключом — один заказ (позиции складываются);
 *  - ключ позиции «ключ заказа|наименование|ед.» (регистр/пробелы не важны), повтор в заказе — «#2», «#3»;
 *  - позиция, уже пришедшая с листа «Заказы» (тот же заказ и то же наименование), не дублируется — дополняется
 *    пустыми полями; существующие поля шапки и позиций не перезаписываются;
 *  - повторный запуск ничего не создаёт (поиск по importKey).
 * Компания из строки «Поставщик:»: СпортИН-ЮГ → СИЮ, Спортстройюг → ССЮ; другая (Спортсет) — заказ без компании,
 * в отчёт (решение пользователя — TASKS З.9). Цен в файлах нет — суммы позиций 0 (заполнят в приложении/листе).
 * Картинки (столбец «Вид») не переносятся — TASKS З.4.
 */
const fs = require('fs');
const path = require('path');
const backend = path.join(__dirname, '..');
// драйвер — из mongoose (pnpm не кладёт mongodb в корень node_modules)
const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), backend] })).mongo;

function loadFflate() {
  try { return require(require.resolve('fflate', { paths: [process.cwd(), backend] })); } catch { /* pnpm: только в .pnpm */ }
  const pnpm = path.join(backend, 'node_modules', '.pnpm');
  const dir = fs.existsSync(pnpm) && fs.readdirSync(pnpm).filter((d) => /^fflate@/.test(d)).sort().pop();
  if (!dir) throw new Error('Не найден пакет fflate в backend/node_modules');
  return require(path.join(pnpm, dir, 'node_modules', 'fflate'));
}
const { unzipSync, strFromU8 } = loadFflate();

// ───────────── чтение .xlsx (первый лист, значения ячеек) ─────────────
const xmlDec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&');

/** → [{ r: номер строки, c: { A: значение, B: … } }] */
const PHOTOS = process.argv.includes('--photos');
/** Фото позиции: файл в UPLOAD_DIR (как загрузка в приложении) + запись photos; у позиции уже есть фото — пропуск. */
async function attachPhotos(db, line, l, write, st) {
  if (!PHOTOS || !l.images?.length) return;
  if (line.photoIds?.length) { st.photosKept = (st.photosKept || 0) + 1; return; }
  st.photosNew = (st.photosNew || 0) + l.images.length;
  if (!write || !line._id) return;
  const dir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const ids = [];
  for (const [i, img] of l.images.entries()) {
    const filename = require('crypto').randomUUID() + '.' + img.ext;
    fs.writeFileSync(path.join(dir, filename), img.buf);
    const now = new Date();
    const r = await db.collection('photos').insertOne({ storageUrl: '/uploads/' + filename, originalFilename: `${String(l.title).slice(0, 60)} ${i + 1}.${img.ext}`, mimeType: img.mime, sizeBytes: img.buf.length, variant: 'original', source: 'import-xlsx', deletedAt: null, createdAt: now, updatedAt: now });
    ids.push(r.insertedId);
  }
  await db.collection('incomes').updateOne({ _id: line._id }, { $set: { photoIds: ids, updatedAt: new Date() } });
}

function readXlsx(file) {
  const z = unzipSync(fs.readFileSync(file), { filter: (x) => !/media|\.bin$/.test(x.name) });
  const g = (n) => (z[n] ? strFromU8(z[n]) : '');
  const shared = [];
  for (const m of g('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlDec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  const wb = g('xl/workbook.xml'), rels = g('xl/_rels/workbook.xml.rels');
  const first = wb.match(/<sheet [^>]*r:id="([^"]*)"/);
  const target = first && (rels.match(new RegExp(`Id="${first[1]}"[^>]*Target="([^"]*)"`)) || rels.match(new RegExp(`Target="([^"]*)"[^>]*Id="${first[1]}"`)));
  const sheet = g('xl/' + (target ? target[1].replace(/^\/?xl\//, '') : 'worksheets/sheet1.xml'));
  const rows = [];
  for (const r of sheet.matchAll(/<row [^>]*r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const c = {};
    for (const cell of (r[2] || '').matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[2], body = cell[3] || '';
      const t = (attrs.match(/t="(\w+)"/) || [])[1];
      let v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (t === 'inlineStr') v = xmlDec([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      if (v === undefined) continue;
      if (t === 's') v = shared[+v];
      else if (t === 'str') v = xmlDec(v);
      else if (!t || t === 'n') v = Number(v);
      if (typeof v === 'string') { v = v.replace(/[\s ]+/g, ' ').trim(); if (!v) continue; }
      c[cell[1]] = v;
    }
    if (Object.keys(c).length) rows.push({ r: +r[1], c });
  }
  return rows;
}

/** Картинки листа по строкам (TASKS З.4): рисунок → якорь «from row» → файл xl/media. EMF/WMF браузер не покажет — пропуск. */
function readImages(file) {
  const z = unzipSync(fs.readFileSync(file));
  const g = (n) => (z[n] ? strFromU8(z[n]) : '');
  const byRow = new Map();
  const sheetRels = Object.keys(z).find((n) => /^xl\/worksheets\/_rels\/sheet1\.xml\.rels$/.test(n));
  const drawing = sheetRels && (g(sheetRels).match(/Target="([^"]*drawings\/drawing\d+\.xml)"/) || [])[1];
  if (!drawing) return byRow;
  const dPath = 'xl/drawings/' + drawing.split('/').pop();
  const dRels = g('xl/drawings/_rels/' + drawing.split('/').pop() + '.rels');
  const target = (rid) => (dRels.match(new RegExp('Id="' + rid + '"[^>]*Target="([^"]*)"')) || dRels.match(new RegExp('Target="([^"]*)"[^>]*Id="' + rid + '"')) || [])[1];
  for (const a of g(dPath).matchAll(/<xdr:(?:two|one)CellAnchor[\s\S]*?<\/xdr:(?:two|one)CellAnchor>/g)) {
    const row = (a[0].match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/) || [])[1];
    const rid = (a[0].match(/r:embed="([^"]+)"/) || [])[1];
    if (row === undefined || !rid) continue;
    const t = target(rid); if (!t) continue;
    const media = 'xl/media/' + t.split('/').pop();
    const ext = media.split('.').pop().toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) || !z[media]) continue;
    const r = +row + 1;
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r).push({ buf: Buffer.from(z[media]), ext: ext === 'jpeg' ? 'jpg' : ext, mime: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) });
  }
  return byRow;
}

// ───────────── нормализация ─────────────
const clean = (v) => String(v ?? '').replace(/[\s ]+/g, ' ').trim();
const normOrderNo = (v) => clean(String(v ?? '').replace(/№/g, ' ')).toUpperCase();
const orderKey = (company, no) => `${clean(company).toUpperCase()}|${normOrderNo(no)}`;
const normTitle = (v) => clean(v).toLowerCase().replace(/ё/g, 'е');
const normUnit = (v) => { const u = clean(v).toLowerCase(); return u === 'пар' ? 'пара' : u || undefined; };
const cleanCustomer = (v) => clean(String(v ?? '').replace(/[\s,;]+$/g, '').replace(/^[\s,;:]+/, '')) || undefined;

function utc(y, m, d) {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : undefined;
}
const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
/** Дата из текста: дд.мм.гггг, дд.мм.гг, «31 августа 2026». → { date, raw, short } */
function findDate(text) {
  const s = String(text ?? '');
  let m = /(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)/.exec(s);
  if (m) return { date: utc(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]), raw: m[0], short: m[3].length === 2 };
  m = /(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i.exec(s);
  if (m) {
    const w = m[2].toLowerCase();
    // «мая» / «май» — отдельно, иначе «ма» совпало бы с «марта»
    const idx = /^ма[йя]$/.test(w) ? 4 : MONTHS.findIndex((p, i) => i !== 4 && w.startsWith(p));
    if (idx >= 0) return { date: utc(+m[3], idx + 1, +m[1]), raw: m[0], short: false };
  }
  return undefined;
}
const iso = (d) => (d ? d.toISOString().slice(0, 10) : '—');

/** Наша компания по строке «Поставщик:». */
function companyOf(supplier) {
  const s = clean(supplier).toLowerCase().replace(/[\s\-–—_]/g, '');
  if (s === 'спортинюг') return { short: 'СИЮ', known: true };
  if (s === 'спортстройюг') return { short: 'ССЮ', known: true };
  if (s === 'спортсет') return { short: 'СПОРТСЕТ', known: true }; // третья наша компания (решение 2026-10-20)
  return { short: clean(supplier).toUpperCase() || '?', known: false, label: clean(supplier) || '(пусто)' };
}

// ───────────── разбор одного файла ─────────────
function parseFile(file) {
  const rows = readXlsx(file);
  const name = path.basename(file);
  const o = { files: [name], lines: [], notes: [], dates: [], skipped: 0, form: 'A' };
  const headerIdx = rows.findIndex((x) => clean(x.c.A) === '№' && /НАИМЕНОВАНИЕ/i.test(clean(x.c.B)));
  if (headerIdx < 0) throw new Error(`${name}: не найдена строка заголовка «№ | НАИМЕНОВАНИЕ»`);
  const titleParts = [];
  for (const { c } of rows.slice(0, headerIdx)) {
    const t = clean(Object.keys(c).sort().map((k) => c[k]).join(' '));
    let m;
    if ((m = /^Поставщик\s*:\s*(.*)$/i.exec(t))) o.supplier = clean(m[1]);
    else if ((m = /^ЗАКАЗ(?![А-ЯЁа-яё])\s*(.*)$/i.exec(t))) o.orderNo = clean(m[1].replace(/^№/, '').replace(/№/g, ' '));
    else if ((m = /^Форма оплаты\s*:\s*(.*)$/i.exec(t))) o.paymentForm = clean(m[1]) || undefined;
    else if ((m = /^Контракт\s*№?\s*(\S+)(?:\s+от\s+(.*))?$/i.exec(t))) {
      o.form = 'B'; o.contractNo = clean(m[1]);
      const d = findDate(m[2]); if (d) { o.contractDate = d.date; o.dates.push({ what: 'дата контракта', ...d }); }
    } else if (/^Начало поставки/i.test(t)) o.notes.push(t);
    else if ((m = /^Окончание поставки[^:]*:\s*(.*)$/i.exec(t))) {
      const d = findDate(m[1]); if (d) { o.deliveryDeadline = d.date; o.dates.push({ what: 'окончание поставки', ...d }); } else o.notes.push(t);
    } else if ((m = /^ЗАКАЗЧИК\s*:?\s*(.*)$/i.exec(t))) {
      const rest = m[1];
      const ship = /ДАТА ОТГРУЗКИ\s*:\s*(.*)$/i.exec(rest), prod = /Срок изготовления\s*:\s*(.*)$/i.exec(rest);
      const cut = Math.min(...[ship, prod].filter(Boolean).map((x) => x.index), rest.length);
      o.customer = cleanCustomer(rest.slice(0, cut));
      if (ship) { const d = findDate(ship[1]); o.dates.push({ what: 'дата отгрузки', ...(d || { raw: ship[1] }) }); if (d) o.shipDate = d.date; }
      if (prod) { const d = findDate(prod[1]); o.dates.push({ what: 'срок изготовления', ...(d || { raw: prod[1] }) }); if (d) o.productionDeadline = d.date; }
    } else if (t) titleParts.push(t);
  }
  if (titleParts.length) o.title = titleParts.join(' ');

  // позиции; строки без № под таблицей — описание последней позиции (длинный блок) или примечание к заказу
  const trailing = [];
  for (const { r, c } of rows.slice(headerIdx + 1)) {
    const hasNo = c.A !== undefined && /^\d+$/.test(clean(c.A));
    const title = clean(c.B);
    if (hasNo) {
      if (!title) { o.skipped++; continue; }
      const qty = typeof c.C === 'number' ? c.C : Number(clean(c.C).replace(',', '.'));
      o.lines.push({
        row: r, no: +clean(c.A), title, qty: Number.isFinite(qty) && clean(c.C) !== '' ? qty : undefined,
        unit: normUnit(c.D), kind: clean(c.E) || undefined, color: clean(c.F) || undefined, extra: [],
      });
    } else if (title || c.C !== undefined) {
      trailing.push(clean([c.B, c.C].filter((x) => x !== undefined).join(c.B !== undefined && c.C !== undefined ? ': ' : '')));
    }
  }
  if (PHOTOS) { const imgs = readImages(file); for (const l of o.lines) l.images = imgs.get(l.row) || []; }
  if (trailing.length > 2 && o.lines.length) o.lines[o.lines.length - 1].extra.push(...trailing);
  else o.notes.push(...trailing);
  const co = companyOf(o.supplier);
  o.company = co;
  o.key = orderKey(co.short, o.orderNo);
  return o;
}

// ───────────── сборка заказов ─────────────
function build(dir) {
  const files = fs.readdirSync(dir).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$')).sort((a, b) => a.localeCompare(b, 'ru'));
  const parsed = files.map((f) => parseFile(path.join(dir, f)));
  const orders = new Map();
  const conflicts = [];
  for (const p of parsed) {
    const cur = orders.get(p.key);
    if (!cur) { orders.set(p.key, p); continue; }
    // второй файл того же заказа: позиции складываем, поля шапки — первое непустое (расхождения — в отчёт)
    for (const k of ['customer', 'paymentForm', 'title', 'contractNo']) {
      if (p[k] && cur[k] && clean(p[k]).toLowerCase() !== clean(cur[k]).toLowerCase()) conflicts.push(`${p.key}: ${k} «${cur[k]}» ≠ «${p[k]}» (${p.files[0]})`);
      if (!cur[k] && p[k]) cur[k] = p[k];
    }
    for (const k of ['contractDate', 'shipDate', 'productionDeadline', 'deliveryDeadline']) {
      if (p[k] && cur[k] && +p[k] !== +cur[k]) conflicts.push(`${p.key}: ${k} ${iso(cur[k])} ≠ ${iso(p[k])} (${p.files[0]})`);
      if (!cur[k] && p[k]) cur[k] = p[k];
    }
    cur.files.push(...p.files); cur.lines.push(...p.lines); cur.notes.push(...p.notes); cur.dates.push(...p.dates); cur.skipped += p.skipped;
  }
  // заказчики: один вариант записи на всех (самый частый среди файлов)
  const variants = new Map();
  for (const o of orders.values()) if (o.customer) {
    const k = o.customer.toLowerCase();
    if (!variants.has(k)) variants.set(k, new Map());
    variants.get(k).set(o.customer, (variants.get(k).get(o.customer) || 0) + 1);
  }
  const unified = [];
  for (const o of orders.values()) if (o.customer) {
    const v = variants.get(o.customer.toLowerCase());
    const best = [...v.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (v.size > 1 && best !== o.customer) unified.push(`«${o.customer}» → «${best}»`);
    o.customer = best;
  }
  // позиции: номер по порядку, ключ «заказ|наименование|ед.» (+ #n на повторы)
  for (const o of orders.values()) {
    const seen = new Map();
    o.lines.forEach((l, i) => {
      l.lineNo = i + 1;
      const base = `${o.key}|${normTitle(l.title)}|${l.unit || ''}`;
      const n = (seen.get(base) || 0) + 1; seen.set(base, n);
      l.key = n > 1 ? `${base}#${n}` : base;
      l.notes = l.extra.length ? l.extra.join('\n') : undefined;
    });
  }
  return { files, parsed, orders: [...orders.values()], conflicts, unified };
}

// ───────────── запись в базу ─────────────
async function apply(db, orders, write) {
  const ours = await db.collection('organizations').find({ deletedAt: null, isOurCompany: true }, { projection: { name: 1, shortName: 1 } }).toArray();
  const ourId = (short) => ours.find((x) => clean(x.shortName || x.name).toUpperCase() === short)?._id;
  const st = { ordersNew: 0, ordersFound: 0, ordersEnriched: 0, linesNew: 0, linesFound: 0, linesFromSheet: 0, linesEnriched: 0, linesLinked: 0, missingCompany: [] };
  const shortOf = (id) => { const x = ours.find((c) => String(c._id) === String(id)); return x ? clean(x.shortName || x.name).toUpperCase() : ''; };
  const legacy = new Map();
  for (const d of await db.collection('incomes').find({ deletedAt: null, orderId: { $exists: false }, orderNo: { $nin: [null, ''] } }).toArray()) {
    const k = orderKey(shortOf(d.companyId), d.orderNo);
    if (!legacy.has(k)) legacy.set(k, []);
    legacy.get(k).push(d);
  }
  const now = new Date();
  const fillEmpty = (doc, want) => {
    const set = {};
    for (const [k, v] of Object.entries(want)) if (v !== undefined && v !== null && v !== '' && (doc[k] === undefined || doc[k] === null || doc[k] === '')) set[k] = v;
    return set;
  };
  for (const o of orders) {
    const companyId = o.company.known ? ourId(o.company.short) : undefined;
    if (o.company.known && !companyId) st.missingCompany.push(`${o.key}: в organizations нет нашей компании ${o.company.short}`);
    const notes = [...o.notes, ...(o.company.known ? [] : [`Поставщик в файле: ${o.company.label} — компания не определена (TASKS З.9)`])].join('\n') || undefined;
    const want = {
      orderNo: o.orderNo, companyId, customer: o.customer, title: o.title, paymentForm: o.paymentForm, contractNo: o.contractNo,
      contractDate: o.contractDate, shipDate: o.shipDate, productionDeadline: o.productionDeadline, deliveryDeadline: o.deliveryDeadline, notes,
    };
    let header = await db.collection('salesorders').findOne({ importKey: o.key });
    if (!header) {
      st.ordersNew++;
      header = { _id: new ObjectId(), ...want, stage: 'new', importKey: o.key, source: 'import-xlsx', importFiles: o.files, deletedAt: null, createdAt: now, updatedAt: now };
      for (const k of Object.keys(header)) if (header[k] === undefined) delete header[k];
      if (write) await db.collection('salesorders').insertOne(header);
    } else {
      st.ordersFound++;
      const set = fillEmpty(header, want);
      if (Object.keys(set).length) {
        st.ordersEnriched++;
        Object.assign(header, set);
        if (write) await db.collection('salesorders').updateOne({ _id: header._id }, { $set: { ...set, updatedAt: now }, $addToSet: { importFiles: { $each: o.files } } });
      }
    }
    // строки листа «Заказы», загруженные до З.2 (без шапки), с тем же «компания|номер» — это позиции этого заказа
    const orphans = (legacy.get(o.key) || []).filter((d) => !d.orderId);
    for (const d of orphans) {
      d.orderId = header._id; st.linesLinked++;
      if (write) await db.collection('incomes').updateOne({ _id: d._id, orderId: { $exists: false } }, { $set: { orderId: header._id, updatedAt: now } });
    }
    // позиции: по importKey; иначе — строка листа «Заказы» в этом заказе с тем же наименованием; иначе — новая
    const existing = await db.collection('incomes').find({ orderId: header._id, deletedAt: null }).toArray();
    for (const d of orphans) if (!existing.some((e) => String(e._id) === String(d._id))) existing.push(d); // dry-run: привязка не записана
    const claimed = new Set();
    for (const l of o.lines) {
      const lineWant = { lineNo: l.lineNo, qty: l.qty, unit: l.unit, kind: l.kind, color: l.color, notes: l.notes };
      let cur = existing.find((d) => d.importKey === l.key) || await db.collection('incomes').findOne({ importKey: l.key });
      if (cur) { st.linesFound++; claimed.add(String(cur._id)); await attachPhotos(db, cur, l, write, st); continue; }
      cur = existing.find((d) => !d.importKey && !claimed.has(String(d._id)) && normTitle(d.title) === normTitle(l.title));
      if (cur) {
        claimed.add(String(cur._id));
        st.linesFromSheet++;
        const set = { importKey: l.key, ...fillEmpty(cur, lineWant) };
        if (Object.keys(set).length > 1) st.linesEnriched++;
        if (write) await db.collection('incomes').updateOne({ _id: cur._id }, { $set: { ...set, updatedAt: now } });
        await attachPhotos(db, cur, l, write, st);
        continue;
      }
      st.linesNew++;
      const doc = {
        orderId: header._id, lineNo: l.lineNo, orderNo: header.orderNo, customer: header.customer, companyId: header.companyId,
        paymentForm: header.paymentForm, shipDate: header.shipDate, title: l.title, qty: l.qty, unit: l.unit, kind: l.kind, color: l.color,
        notes: l.notes, amount: 0, reportDate: header.shipDate, importKey: l.key, source: 'import-xlsx', deletedAt: null, createdAt: now, updatedAt: now,
      };
      for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k];
      if (write) { const ins = await db.collection('incomes').insertOne(doc); doc._id = ins.insertedId; }
      await attachPhotos(db, doc, l, write, st);
    }
  }
  return st;
}

(async () => {
  const dir = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const write = process.argv.includes('--apply');
  if (!dir || !fs.existsSync(dir)) { console.error('Использование: node scripts/import-orders-xlsx.js <папка с .xlsx> [--apply]'); process.exit(2); }
  const { files, parsed, orders, conflicts, unified } = build(dir);

  const lines = orders.reduce((a, o) => a + o.lines.length, 0);
  const out = [];
  out.push(`Файлов: ${files.length} (форма «Форма оплаты» — ${parsed.filter((p) => p.form === 'A').length}, форма «Контракт» — ${parsed.filter((p) => p.form === 'B').length})`);
  out.push(`Заказов: ${orders.length}, позиций: ${lines}`);
  const byCo = {};
  for (const o of orders) byCo[o.company.known ? o.company.short : `${o.company.label} (не наша)`] = (byCo[o.company.known ? o.company.short : `${o.company.label} (не наша)`] || 0) + 1;
  out.push(`По компаниям: ${Object.entries(byCo).map(([k, v]) => `${k} — ${v}`).join(', ')}`);
  const merged = orders.filter((o) => o.files.length > 1);
  out.push(`Слиты (один заказ в нескольких файлах): ${merged.length ? '' : 'нет'}`);
  for (const o of merged) out.push(`  ${o.key}: ${o.files.join(' + ')} → ${o.lines.length} поз.`);
  if (conflicts.length) { out.push('Расхождения в слитых файлах (взято первое):'); for (const c of conflicts) out.push(`  ${c}`); }
  const unknown = orders.filter((o) => !o.company.known);
  out.push(`Неизвестная компания (импорт без компании, этап «Новый», решение — З.9): ${unknown.length ? '' : 'нет'}`);
  for (const o of unknown) out.push(`  ${o.key} — ${o.customer ?? '—'}, ${o.lines.length} поз. (${o.files.join(', ')})`);
  const sus = [];
  for (const o of orders) {
    if (!o.orderNo) sus.push(`${o.files[0]}: нет номера заказа`);
    if (!o.customer) sus.push(`${o.key}: нет заказчика`);
    for (const d of o.dates) {
      if (!d.date) sus.push(`${o.key}: ${d.what} «${clean(d.raw)}» — не разобралась`);
      else if (d.date < new Date(Date.UTC(2026, 0, 1))) sus.push(`${o.key}: ${d.what} ${iso(d.date)} — раньше 2026 года (опечатка в годе?)`);
      else if (d.short) sus.push(`${o.key}: ${d.what} «${d.raw}» — год двумя цифрами, принят как ${iso(d.date)}`);
    }
    if (o.contractDate && o.shipDate && o.shipDate < o.contractDate) sus.push(`${o.key}: отгрузка ${iso(o.shipDate)} раньше контракта ${iso(o.contractDate)}`);
    if (o.productionDeadline && o.deliveryDeadline && o.deliveryDeadline < o.productionDeadline) sus.push(`${o.key}: окончание поставки раньше срока изготовления`);
    if (!o.lines.length) sus.push(`${o.key}: нет позиций`);
    for (const l of o.lines) if (l.qty === undefined) sus.push(`${o.key}: позиция ${l.lineNo} «${l.title.slice(0, 40)}» без количества`);
  }
  out.push(`Подозрительное: ${sus.length ? '' : 'нет'}`);
  for (const s of sus) out.push(`  ${s}`);
  const skipped = orders.reduce((a, o) => a + o.skipped, 0);
  if (skipped) out.push(`Пропущено строк без наименования: ${skipped} (${orders.filter((o) => o.skipped).map((o) => o.key).join(', ')})`);
  if (unified.length) { out.push('Заказчик — единая запись:'); for (const u of [...new Set(unified)]) out.push(`  ${u}`); }
  // похожие записи одного заказчика (опечатка «й/и», кавычки) — не исправляются автоматически, только в отчёт
  const loose = new Map();
  for (const o of orders) if (o.customer) {
    const k = o.customer.toLowerCase().replace(/ё/g, 'е').replace(/й/g, 'и').replace(/[^a-zа-я0-9]/g, '');
    if (!loose.has(k)) loose.set(k, new Set());
    loose.get(k).add(o.customer);
  }
  const similar = [...loose.values()].filter((s) => s.size > 1);
  if (similar.length) { out.push('Похожие заказчики (проверить вручную, не исправлялось):'); for (const s of similar) out.push(`  ${[...s].map((x) => `«${x}»`).join(' / ')}`); }
  const units = {};
  for (const o of orders) for (const l of o.lines) units[l.unit || '(пусто)'] = (units[l.unit || '(пусто)'] || 0) + 1;
  out.push(`Единицы: ${Object.entries(units).map(([k, v]) => `${k} — ${v}`).join(', ')}`);
  const withNotes = orders.filter((o) => o.notes.length).map((o) => o.key);
  const lineNotes = orders.flatMap((o) => o.lines.filter((l) => l.notes).map((l) => `${o.key} поз. ${l.lineNo} (${l.extra.length} строк)`));
  if (withNotes.length) out.push(`Примечание к заказу: ${withNotes.join(', ')}`);
  if (lineNotes.length) out.push(`Описание/характеристики в примечание позиции: ${lineNotes.join(', ')}`);

  const uri = process.env.MONGO_URI;
  if (!uri) { console.log(out.join('\n')); console.log('\n(MONGO_URI не задан — только разбор файлов, база не проверялась)'); return; }
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    const st = await apply(db, orders, write);
    console.log(`База: ${db.databaseName}. Режим: ${write ? 'ЗАПИСЬ' : 'только отчёт (dry-run)'}`);
    console.log(out.join('\n'));
    console.log(`Итог в базе${write ? '' : ' (если запустить с --apply)'}:`);
    console.log(`  заказы: новых ${st.ordersNew}, уже есть ${st.ordersFound} (дополнено пустых полей: ${st.ordersEnriched})`);
    console.log(`  позиции: новых ${st.linesNew}, уже импортированы ${st.linesFound}, найдены с листа «Заказы» ${st.linesFromSheet} (дополнено: ${st.linesEnriched})`);
    if (PHOTOS) console.log(`  фото позиций: ${write ? "загружено" : "будет загружено"} ${st.photosNew || 0}, у позиций уже есть фото — ${st.photosKept || 0}`);
    if (st.linesLinked) console.log(`  строк листа «Заказы» без шапки привязано к заказам: ${st.linesLinked}`);
    for (const m of st.missingCompany) console.log(`  ⚠ ${m}`);
  } finally {
    await client.close();
  }
})().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
