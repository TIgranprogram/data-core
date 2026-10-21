/**
 * Короткое имя изделия из названия позиции заказа (TASKS БЗ-5): в заказах title — длинное описание
 * («Трибуны на 200 мест, 20,02 м Цвет: графит 6 рядов…»). Берём начало до «Цвет:» / точки / перевода строки, не длиннее 120 знаков.
 * Полное описание остаётся в позиции заказа и копируется в описание изделия.
 */
export function shortProductName(title: string): string {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim();
  const cut = t.search(/\s(?:цвет|размеры?|высота|требовани[ея])\s*:|\.\s|;/i);
  let s = (cut > 0 ? t.slice(0, cut) : t).trim().replace(/[,.:;\s]+$/, '');
  if (s.length > 120) { const sp = s.lastIndexOf(' ', 120); s = s.slice(0, sp > 40 ? sp : 120).trim(); }
  return s;
}

export const productNameKey = (name: string) => String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
