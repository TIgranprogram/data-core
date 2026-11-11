/* Чистые функции для отчёта дублей текстов паспортов (БЗ-6 Э3b). Без зависимостей, без обращения к базе. */

const EDGE = /^[\s.,;:!?\-–—«»"“”„'`()\[\]]+|[\s.,;:!?\-–—«»"“”„'`()\[\]]+$/g;

/** Нормализация: нижний регистр, ё→е, кавычки «»"“” убраны, пробелы схлопнуты, пунктуация по краям срезана. */
function normalize(s) {
  if (s == null) return '';
  let t = String(s).toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.replace(EDGE, '').replace(/\s+/g, ' ');
}

function words(norm) {
  return norm.split(/[^a-zа-я0-9]+/i).filter(Boolean);
}

/** Коэффициент Дайса по множествам слов (0..1). */
function dice(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return (2 * n) / (A.size + B.size);
}

/** Расстояние Левенштейна; maxDist — досрочный выход (вернёт maxDist+1, если больше). */
function levenshtein(a, b, maxDist = Infinity) {
  if (a === b) return 0;
  if (a.length < b.length) [a, b] = [b, a];
  if (a.length - b.length > maxDist) return maxDist + 1;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return maxDist + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Относительное расстояние: Левенштейн / длина длинной строки (0..1). */
function levRatio(a, b) {
  const L = Math.max(a.length, b.length);
  if (!L) return 0;
  return levenshtein(a, b, Math.floor(L * 0.1) + 1) / L;
}

/** Почти-дубль (по уже нормализованным строкам): Дайс по словам >= 0.85 или Левенштейн <= 10% длины. */
function isNearDuplicate(a, b, diceMin = 0.85, levMax = 0.1) {
  if (a === b) return false;
  const L = Math.max(a.length, b.length);
  if (L && Math.abs(a.length - b.length) / L <= levMax && levRatio(a, b) <= levMax) return true;
  return dice(a, b) >= diceMin;
}

/**
 * Группировка точных дублей после нормализации.
 * counts: Map<сырое значение, число паспортов>. Возвращает группы { norm, total, variants:[{text,count}], canonical }.
 * Только группы с >1 вариантом написания; сортировка по total убыв.
 */
function groupExact(counts) {
  const m = new Map();
  for (const [raw, n] of counts) {
    const k = normalize(raw);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push({ text: raw, count: n });
  }
  const out = [];
  for (const [norm, variants] of m) {
    if (variants.length < 2) continue;
    variants.sort((x, y) => y.count - x.count || x.text.localeCompare(y.text));
    out.push({ norm, total: variants.reduce((s, v) => s + v.count, 0), variants, canonical: variants[0].text });
  }
  return out.sort((a, b) => b.total - a.total);
}

/**
 * Почти-дубли между разными нормализованными формами (попарно, не более maxUnique форм).
 * Возвращает { pairs:[{a,b,dice,lev,countA,countB}], skipped }. Для формы берётся самое частое написание.
 */
function findNearDuplicates(counts, { maxUnique = 2000, diceMin = 0.85, levMax = 0.1 } = {}) {
  const m = new Map();
  for (const [raw, n] of counts) {
    const k = normalize(raw);
    if (!k) continue;
    const e = m.get(k) || { norm: k, text: raw, best: 0, count: 0 };
    e.count += n;
    if (n > e.best) { e.best = n; e.text = raw; }
    m.set(k, e);
  }
  let list = [...m.values()].sort((a, b) => b.count - a.count);
  const skipped = Math.max(0, list.length - maxUnique);
  list = list.slice(0, maxUnique);
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (isNearDuplicate(a.norm, b.norm, diceMin, levMax)) {
        pairs.push({ a: a.text, b: b.text, dice: +dice(a.norm, b.norm).toFixed(3), lev: +levRatio(a.norm, b.norm).toFixed(3), countA: a.count, countB: b.count });
      }
    }
  }
  pairs.sort((x, y) => y.countA + y.countB - (x.countA + x.countB));
  return { pairs, skipped };
}

/** Разбивка по категориям: docs=[{category, value}] → [{category, passports, distinctRaw, distinctNorm}]. */
function byCategory(docs) {
  const m = new Map();
  for (const { category, value } of docs) {
    const norm = normalize(value);
    if (!norm) continue;
    const c = category == null || category === '' ? '(без категории)' : String(category);
    const e = m.get(c) || { category: c, passports: 0, raw: new Set(), norm: new Set() };
    e.passports++; e.raw.add(String(value)); e.norm.add(norm);
    m.set(c, e);
  }
  return [...m.values()].map((e) => ({ category: e.category, passports: e.passports, distinctRaw: e.raw.size, distinctNorm: e.norm.size }))
    .sort((a, b) => b.distinctNorm - a.distinctNorm || a.category.localeCompare(b.category));
}

module.exports = { normalize, words, dice, levenshtein, levRatio, isNearDuplicate, groupExact, findNearDuplicates, byCategory };
