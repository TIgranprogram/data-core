/*
 * C111 Ш2: короткие подписи панели «Паспорта заказа» — чистые функции без DOM (тест — order-passport-text.test.mjs).
 * Сервер шлёт причины полным текстом («Обязательный рисунок не читается: Фото изделия. Загрузите изображение заново»,
 * «Рисунок: Чертёж с размерами», «и ещё 10»). В строке позиции — только названия недостающего; полный текст — в раскрытой позиции.
 */

const MORE = /^и ещё (\d+)$/i;

/** Одна причина → название недостающего («Фото изделия»). */
export function missingName(m) {
  let s = String(m ?? '').trim();
  const colon = s.match(/^(?:обязательный\s+)?рисун[а-яё]*(?:\s+не\s+читается)?\s*:\s*(.+)$/i);
  if (colon) s = colon[1];
  s = s.replace(/\.\s*(?:загрузите|замените|добавьте)[^.]*\.?$/i, '').replace(/\.$/, '').trim();
  return s;
}

const lowerFirst = (s) => (s && !/^[A-ZА-ЯЁ]{2}/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Причины позиции → «Фото изделия, чертёж с размерами, габариты и ещё 2». max — сколько названий показать. */
export function shortMissing(missing, max = 4) {
  const names = [];
  const seen = new Set();
  let extra = 0;
  for (const m of missing || []) {
    const more = String(m ?? '').trim().match(MORE);
    if (more) { extra += Number(more[1]); continue; }
    const n = missingName(m);
    const key = n.toLowerCase();
    if (!n || seen.has(key)) continue;
    seen.add(key);
    names.push(n);
  }
  if (names.length > max) { extra += names.length - max; names.length = max; }
  if (!names.length) return extra ? `ещё ${extra}` : '';
  const text = names.map((n, i) => (i ? lowerFirst(n) : upperFirst(n))).join(', ');
  return extra ? `${text} и ещё ${extra}` : text;
}

const plural = (n, one, few, many) => {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
};

/** Сводка панели: «Готово 0 из 12 · заполнить: 9 позиций». */
export function summaryText(row) {
  const done = (row?.ready || 0) + (row?.issued || 0);
  const blocked = (row?.lines || []).filter((l) => l.state === 'blocked').length || row?.blocked || 0;
  const base = `Готово ${done} из ${row?.total || 0}`;
  return blocked ? `${base} · заполнить: ${blocked} ${plural(blocked, 'позицию', 'позиции', 'позиций')}` : base;
}
