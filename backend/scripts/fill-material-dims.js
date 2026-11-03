/* C009 фаза 3: из имени material вытащить размеры в dimensions[] / assortment, только где пусто.
 * План по умолчанию (ничего не пишет), запись — с --apply.
 * M10×100 → length; «N мм» / хвост профиля → thickness; Ø → diameter; «Труба|Лист …» → assortment если пусто.
 * Не трогает уже заполненные type в dimensions и непустой assortment.
 *
 *   docker cp backend/scripts/fill-material-dims.js datacore-backend:/app/scripts/
 *   docker exec datacore-backend node scripts/fill-material-dims.js [--apply] [--limit=N]
 */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
const apply = process.argv.includes('--apply');
const limArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limArg ? Math.max(1, Number(limArg.slice(8)) || 0) : 0;

const num = (s) => Math.round(Number(String(s).replace(',', '.')) * 100) / 100;

/** Разбор имени → кандидаты размеров (мм) и сортамента. */
function parseName(name) {
  const n = String(name || '');
  const out = { length: null, thickness: null, diameter: null, width: null, assortment: null };
  const mx = n.match(/[MМ]\s?\d+(?:[.,]\d+)?\s?[xхX×]\s?(\d+(?:[.,]\d+)?)/);
  if (mx) out.length = num(mx[1]);
  const pipe = n.match(/(?:^|[\s,])((?:Труба|Лист)\s+[^,;]{2,60})/i);
  if (pipe) out.assortment = pipe[1].replace(/\s+/g, ' ').trim();
  const prof = n.match(/(\d+(?:[.,]\d+)?)\s?[xхX×]\s?(\d+(?:[.,]\d+)?)(?:\s?[xхX×]\s?(\d+(?:[.,]\d+)?))?/);
  if (prof && !mx) {
    const a = num(prof[1]), b = num(prof[2]), c = prof[3] != null ? num(prof[3]) : null;
    if (c != null && c > 0 && c < 50) out.thickness = c;
    else if (b > 0 && b < 30 && a >= b) out.thickness = b;
  }
  const th = n.match(/(?:^|[\s,])(\d+(?:[.,]\d+)?)\s*мм\b/i);
  if (th && out.thickness == null) {
    const t = num(th[1]);
    if (t > 0 && t < 100) out.thickness = t;
  }
  const dia = n.match(/[Øø⌀]\s?(\d+(?:[.,]\d+)?)/);
  if (dia) out.diameter = num(dia[1]);
  return out;
}

function dimsMap(dimensions) {
  const m = {};
  for (const d of Array.isArray(dimensions) ? dimensions : []) {
    if (d && d.type && Number(d.value) > 0) m[d.type] = Number(d.value);
  }
  return m;
}

function toArr(map) {
  return ['length', 'width', 'thickness', 'diameter']
    .filter((k) => map[k] > 0)
    .map((k) => ({ type: k, value: map[k], isImmutable: false }));
}

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Нужен MONGO_URI (строка подключения к базе)');
  const client = await MongoClient.connect(uri);
  try {
    const col = client.db().collection('materials');
    const docs = await col.find({ deletedAt: null }, { projection: { name: 1, dimensions: 1, assortment: 1 } }).toArray();
    const plan = [];
    for (const doc of docs) {
      const parsed = parseName(doc.name);
      const curDims = dimsMap(doc.dimensions);
      const add = {};
      for (const k of ['length', 'width', 'thickness', 'diameter']) {
        if (parsed[k] > 0 && !(curDims[k] > 0)) add[k] = parsed[k];
      }
      const needAssort = parsed.assortment && !String(doc.assortment || '').trim();
      if (!Object.keys(add).length && !needAssort) continue;
      plan.push({
        id: doc._id,
        name: doc.name,
        setDims: Object.keys(add).length ? { ...curDims, ...add } : null,
        setAssortment: needAssort ? parsed.assortment : null,
        add,
      });
      if (limit && plan.length >= limit) break;
    }

    console.log(`План: заполнить ${plan.length} позиций (только пустые поля).`);
    const sample = plan.slice(0, 15);
    for (const p of sample) {
      const bits = [];
      if (p.setDims) bits.push('dims+' + Object.keys(p.add).map((k) => `${k}=${p.add[k]}`).join(','));
      if (p.setAssortment) bits.push('assortment=' + JSON.stringify(p.setAssortment));
      console.log(`  · ${p.name} → ${bits.join('; ')}`);
    }
    if (plan.length > sample.length) console.log(`  … ещё ${plan.length - sample.length}`);
    if (!apply) { console.log('Это план. Запись — с --apply.'); return; }

    let ok = 0;
    const now = new Date();
    for (const p of plan) {
      const set = { updatedAt: now };
      if (p.setDims) set.dimensions = toArr(p.setDims);
      if (p.setAssortment) set.assortment = p.setAssortment;
      const res = await col.updateOne({ _id: p.id, deletedAt: null }, { $set: set });
      if (res.modifiedCount) ok++;
    }
    console.log(`Записано: ${ok} из ${plan.length}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
