/**
 * Разбор строк, вставленных из Excel / с сайта (TASKS В.8): «артикул · наименование · …лишнее… · кол-во · цена · сумма».
 * Из Excel приходят колонки через Tab; из чата / некоторых сайтов — текст через пробелы. Оба варианта.
 * Лишние колонки (материал, «розница до 100», оптовая группа) не берутся. Количество подтверждается проверкой кол-во × цена = сумма.
 *   parsePasted(text) → [{ article, name, qty, price, sum, raw }]
 */
const NUM = (s) => {
  const t = String(s ?? '').replace(/ /g, ' ').replace(/[рp]\.?$|₽|руб\.?/gi, '').replace(/\s+/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
};
/** Похоже на артикул: без пробелов, есть цифра или дефис, не чистое число. */
const isCode = (s) => /^[\p{L}\d][\p{L}\d\-._/]{1,40}$/u.test(s) && /[\d\-]/.test(s) && !/^\d+([.,]\d+)?$/.test(s);
const near = (a, b) => Math.abs(a - b) <= Math.max(1, b * 0.01);

function fromCells(cells) {
  cells = cells.map((c) => c.replace(/ /g, ' ').trim()).filter((c) => c !== '');
  if (!cells.length) return null;
  const nums = cells.map((c, i) => ({ i, v: NUM(c) })).filter((x) => !Number.isNaN(x.v));
  // количество × цена = сумма — в ЛЮБОМ порядке колонок; количество — целое; если подходит несколько — берём самую большую сумму
  let qty, price, sum, used = new Set();
  for (const a of nums) for (const b of nums) for (const c of nums) {
    if (a.i === b.i || a.i === c.i || b.i === c.i) continue;
    if (!(Number.isInteger(a.v) && a.v > 0 && b.v > 0 && near(a.v * b.v, c.v))) continue;
    if (sum === undefined || c.v > sum || (c.v === sum && a.v < qty)) { qty = a.v; price = b.v; sum = c.v; used = new Set([a.i, b.i, c.i]); }
  }
  if (qty === undefined) {
    // нет суммы: целое — количество, другое число — цена (сумма = кол-во × цена)
    const ints = nums.filter((x) => Number.isInteger(x.v) && x.v > 0 && x.v < 100000);
    const q = ints[0]; const p = nums.find((x) => x !== q && x.v > 0);
    qty = q?.v ?? 1; price = p?.v; sum = q && p ? Math.round(q.v * p.v * 100) / 100 : undefined;
  }
  // артикул — короткий «код» в любой колонке (не чистое число); наименование — самый длинный текст
  const codes = cells.map((c, i) => ({ c, i })).filter((x) => !used.has(x.i) && isCode(x.c));
  const article = codes[0]?.c || '';
  const texts = cells.filter((c) => c !== article && Number.isNaN(NUM(c)) && /\p{L}/u.test(c) && /\s/.test(c));
  const name = texts.sort((x, y) => y.length - x.length)[0] || cells.filter((c) => c !== article && Number.isNaN(NUM(c)) && /\p{L}/u.test(c)).sort((x, y) => y.length - x.length)[0] || '';
  return { article, name, qty, price, sum };
}

function fromText(line) {
  const s = line.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const tokens = s.split(' ');
  const article = isCode(tokens[0]) ? tokens[0] : '';
  const rest = article ? s.slice(tokens[0].length).trim() : s;
  // деньги: «125,00 р.», «15 500 р.». Пробел — и разделитель тысяч, и граница с соседним числом («до 100 125,00 р.»),
  // поэтому у каждой суммы пробуем все разбиения: «100 125,00» → 100125 или 125
  const money = [...rest.matchAll(/(\d{1,3}(?: \d{3})*|\d+)((?:[.,]\d+)?)\s*(?:р\.|руб\.?|₽)/g)].map((m) => {
    const groups = m[1].split(' ');
    return groups.map((_, k) => ({ v: Number(groups.slice(k).join('') + m[2].replace(',', '.')), at: m.index + groups.slice(0, k).join(' ').length + (k ? 1 : 0) }));
  });
  const ints = (end) => [...rest.slice(0, end).matchAll(/(?<![\d.,])(\d+)(?![\d.,])(?!\s?(?:мм|м\b|см|кг|%|х|x))/g)].map((m) => ({ v: Number(m[1]), at: m.index })).filter((x) => x.v > 0);
  let best = null;
  if (money.length >= 2) {
    const sumV = money[money.length - 1], priceV = money[money.length - 2];
    for (const sm of sumV) for (const pr of priceV) {
      if (pr.at >= sm.at) continue;
      const q = ints(pr.at).filter((x) => near(x.v * pr.v, sm.v)).pop();
      if (q && (!best || sm.v > best.sum)) best = { qty: q.v, qAt: q.at, price: pr.v, sum: sm.v };
    }
  }
  if (!best && money.length) {
    const sm = money[money.length - 1][0];
    const q = ints(sm.at).pop();
    best = { qty: q?.v ?? 1, qAt: q?.at ?? sm.at, price: q ? Math.round((sm.v / q.v) * 100) / 100 : undefined, sum: sm.v };
  }
  const name = (best ? rest.slice(0, best.qAt) : rest).trim().replace(/[\s,;]+$/, '');
  return { article, name, qty: best?.qty ?? 1, price: best?.price, sum: best?.sum };
}

export function parsePasted(text) {
  return String(text || '').split(/\r?\n/).map((line) => {
    if (!line.trim()) return null;
    const r = line.includes('\t') ? fromCells(line.split('\t')) : fromText(line);
    if (!r || !r.name) return null;
    return { ...r, raw: line.trim() };
  }).filter(Boolean)
    // строка-заголовок таблицы («Артикул Наименование Кол-во…») — без чисел, пропускаем
    .filter((r) => !(r.qty === 1 && r.sum === undefined && /наимен|артикул|кол-?во/i.test(r.raw)))
    // строки итогов таблицы
    .filter((r) => !/^(итого|всего|сумма|в т\.?\s?ч\.?|ндс|скидка)(\s|:|$)/i.test(r.name.trim()));
}
