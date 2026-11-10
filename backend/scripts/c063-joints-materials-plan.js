/* C063 (2026-11-10, пользователь: «Конструкция + материалы» — массово закрыть пункты паспорта).
 * Только собирает план из выгрузок прода — в базу не пишет.
 *   node scripts/c063-joints-materials-plan.js <папка-изделий jm> <pp-mat.json> <dict-mats.json> [--joints-default] > docs/crew/C063-joints-materials/plan.json
 * Состав у изделий каталога пуст (выгрузка 2026-11-10: 0 из 480), поэтому:
 *   материалы (materialsSpec, только пустые): из последнего выпущенного паспорта изделия —
 *     materialIds (ссылки на справочник) → строки без размеров; иначе текст «профилей … 120х60х3мм, труба ∅33,5х2,8, Лист 2,3,4 мм …»
 *     разбирается: профиль → «Труба стальная профильная», ∅ → «Труба стальная», лист → «Лист стальной» (+ нержавеющие),
 *     прочие материалы — по названию из справочника; «порошков…» → покрытие «Порошковая окраска» («цинк…» — «Цинкование и …»).
 *   конструкция (passportDefaults.joints, только пустые) — по правилу пользователя, флаг --joints-default:
 *     в тексте/названии «бетон» → solid; иначе металл → bolts + welds. Без флага конструкция не планируется.
 * Записывает deploy/synology/c063-joints-materials.sh — по «да» пользователя (кнопка пульта).
 */
const fs = require('fs');
const path = require('path');

const num = '\\d+(?:[.,]\\d+)?';
const X = '\\s*[хxХX×*]\\s*';
const norm = (s) => String(s).replace('.', ',');
const lower = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е');

/** Справочник → нужные id по названию. */
function dictIndex(dict) {
  const items = dict.items || dict;
  const by = (re, kind) => items.find((d) => re.test(lower(d.name)) && (!kind || (d.kind || 'material') === kind));
  return {
    items,
    profile: by(/^труба стальная профильная$/), pipe: by(/^труба стальная$/), sheet: by(/^лист стальной$/),
    pipeSS: by(/^труба нержавеющая$/), sheetSS: by(/^лист нержавеющий$/),
    powder: by(/^порошковая окраска$/, 'coating'), zincPowder: by(/^цинкование и порошковая окраска$/, 'coating'),
  };
}

/** Чистая функция: текст «Материалы» паспорта → { rows, coatingIds, found[] }. */
function parseMaterials(text, ix) {
  const t = String(text ?? ''); const lt = lower(t);
  const rows = []; const found = [];
  const add = (rec, sizes, why) => { if (!rec) return; const id = String(rec.id || rec._id); const r = rows.find((x) => x.materialId === id); if (r) { for (const s of sizes) if (!r.sizes.includes(s)) r.sizes.push(s); } else rows.push({ materialId: id, sizes: [...sizes], partIds: [] }); found.push(why); };
  const ss = /нерж/.test(lt);
  // профиль: тройки «AxBxC» без ∅
  const prof = [...t.matchAll(new RegExp(`(?<!∅\\s*)(${num})${X}(${num})${X}(${num})`, 'g'))].map((m) => `${norm(m[1])}×${norm(m[2])}×${norm(m[3])}`);
  if (/проф/.test(lt) || prof.length) add(ix.profile, prof, 'профиль');
  // труба круглая: «∅D×T»
  const pipes = [...t.matchAll(new RegExp(`[∅Ø⌀]\\s*(${num})${X}(${num})`, 'g'))].map((m) => `∅${norm(m[1])}×${norm(m[2])}`);
  // труба только с диаметром: «∅102мм», «диаметром 89мм» (рядом слово «труб…»)
  if (/труб/.test(lt)) for (const m of t.matchAll(new RegExp(`(?:[∅Ø⌀]\\s*|диаметр\\w*\\s+)(${num})(?!\\s*[хxХX×*])\\s*мм`, 'gi'))) pipes.push(`∅${norm(m[1])}`);
  if (pipes.length) add(ss && /нерж\w*\s+труб|труб\w*\s+нерж/.test(lt) ? ix.pipeSS : ix.pipe, pipes, 'труба');
  // лист: «Лист 2,3,4,6,8 мм», «Лист 2 и 6мм», «лист 4 мм»
  const sm = /лист\w*\s+((?:\d+(?:\s*(?:,|и)\s*)?)+)\s*мм/i.exec(t);
  if (sm) add(ss && /нерж\w*\s+лист|лист\w*\s+нерж/.test(lt) ? ix.sheetSS : ix.sheet, sm[1].split(/\s*(?:,|и)\s*/).filter(Boolean), 'лист');
  // прочие материалы справочника — все значимые слова названия есть в тексте; из похожих — самая точная запись
  // («Фанера ламинированная» берётся, только если в тексте есть «ламинирован…»; иначе — просто «Фанера»)
  // слово совпадает с начала слова текста; короткое (до 5 букв: «круг», «бетон», «фсф») — только целиком
  const has = (w) => (w.length <= 5 ? new RegExp(`(^|[^а-яa-z])${w}([^а-яa-z]|$)`) : new RegExp(`(^|[^а-яa-z])${w.slice(0, w.length - 2)}`)).test(lt);
  const hits = [];
  for (const d of ix.items) {
    if ((d.kind || 'material') !== 'material' || /порошков/.test(lower(d.name))) continue; // «Сталь с порошковой окраской …» — не материал, а покрытие
    const id = String(d.id || d._id);
    if ([ix.profile, ix.pipe, ix.sheet, ix.pipeSS, ix.sheetSS].some((x) => x && String(x.id || x._id) === id)) continue;
    const words = lower(d.name).split(/[^а-яa-z]+/).filter((w) => w.length >= 3 && !/^(сталь|стальн|окраск|порошк|влаго)/.test(w));
    if (words.length && words.every(has)) hits.push({ d, words });
  }
  for (const h of hits) {
    const wider = hits.some((o) => o !== h && o.words.length > h.words.length && h.words.every((w) => o.words.includes(w)));
    if (!wider) add(h.d, [], h.d.name);
  }
  const coatingIds = [];
  if (/порошк/.test(lt)) { const c = /цинк/.test(lt) ? ix.zincPowder || ix.powder : ix.powder; if (c) { coatingIds.push(String(c.id || c._id)); found.push('покрытие'); } }
  return { rows, coatingIds, found };
}

function buildPlan(jmDir, passports, dict, jointsDefault) {
  const ix = dictIndex(dict);
  const issued = new Map();
  for (const p of passports) {
    if (p.status !== 'issued' || !p.productId) continue;
    const at = String(p.issuedAt || p.createdAt || '');
    const cur = issued.get(String(p.productId));
    if (!cur || at > String(cur.issuedAt || cur.createdAt || '')) issued.set(String(p.productId), p);
  }
  const plan = { spec: [], specManual: [], joints: [], jointsManual: [] };
  for (const f of fs.readdirSync(jmDir).filter((x) => /^[0-9a-f]{24}\.json$/.test(x))) {
    const p = JSON.parse(fs.readFileSync(path.join(jmDir, f), 'utf8'));
    const row = { id: p.id, sku: p.sku || '', name: p.name || '', group: p.group || '', category: p.ppCategory || '' };
    const pp = issued.get(String(p.id));
    if (!(p.materialsSpec?.rows || []).length) {
      if (!pp) plan.specManual.push({ ...row, why: 'нет выпущенного паспорта' });
      else if ((pp.materialIds || []).length) plan.spec.push({ ...row, from: 'ссылки паспорта', materialsSpec: { rows: pp.materialIds.map((id) => ({ materialId: String(id), sizes: [], partIds: [] })), coatingIds: [] } });
      else {
        const r = parseMaterials(pp.materials, ix);
        if (r.rows.length) plan.spec.push({ ...row, from: r.found.join(', '), text: String(pp.materials).slice(0, 160), materialsSpec: { rows: r.rows, coatingIds: r.coatingIds } });
        else plan.specManual.push({ ...row, why: pp.materials ? `не разобрано: ${String(pp.materials).slice(0, 100)}` : 'в паспорте нет материалов' });
      }
    }
    if (!(p.passportDefaults?.joints || []).length) {
      if (!jointsDefault) continue;
      // «бетон» в тексте паспорта — чаще «бетонирование» (установка), поэтому смотрим только название:
      // бетонная часть изделия («бетонными боковинами», «бетонная урна») — вручную, остальное — болты + сварка
      if (/бетонн|из бетона/.test(lower(p.name))) plan.jointsManual.push({ ...row, why: 'есть бетонная часть — выберите в шаблоне паспорта' });
      else plan.joints.push({ ...row, joints: ['bolts', 'welds'] });
    }
  }
  const bySku = (a, b) => String(a.sku).localeCompare(String(b.sku), 'ru', { numeric: true });
  for (const k of Object.keys(plan)) plan[k].sort(bySku);
  return plan;
}

if (require.main === module) {
  const [jmDir, ppFile, dictFile] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!jmDir || !ppFile || !dictFile) { console.error('нужно: <папка jm> <pp-mat.json> <dict-mats.json> [--joints-default]'); process.exit(2); }
  const passports = JSON.parse(fs.readFileSync(ppFile, 'utf8'));
  const dict = JSON.parse(fs.readFileSync(dictFile, 'utf8'));
  const plan = buildPlan(jmDir, passports.items || passports, dict, process.argv.includes('--joints-default'));
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...plan }, null, 2) + '\n');
}

module.exports = { parseMaterials, dictIndex, buildPlan };
