/** C080: проверка КП перед отправкой — чистые правила, без базы. Тексты — на русском, для менеджера. */

export interface ReadyOffer {
  items: Array<{ productName?: string | null; unitPrice?: number | null }>;
  total?: number | null;
  validUntil?: Date | string | null;
}

export interface ReadyCtx {
  /** Есть бланк 1-й страницы у фирмы КП. */
  hasBlank: boolean;
  /** По строкам: есть ли фото (своё или у изделия). Короче items — недостающие считаются «без фото». */
  photos: boolean[];
  /** Сегодня (календарный день); срок «до …» до этого дня включительно ещё действует. */
  today: Date;
}

const dayKey = (d: Date | string): string => new Date(d).toISOString().slice(0, 10);

/** Чего не хватает одному КП. Пустой список — можно отправлять. */
export function offerProblems(o: ReadyOffer, ctx: ReadyCtx): string[] {
  const out: string[] = [];
  const items = o.items || [];
  if (!items.length) out.push('Нет ни одной строки');
  const noPrice = items.filter((i) => !(Number(i.unitPrice) > 0));
  if (noPrice.length) out.push(`Нет цены: ${noPrice.map((i) => `«${i.productName || 'строка'}»`).join(', ')}`);
  const noPhoto = items.filter((_, idx) => !ctx.photos[idx]);
  if (noPhoto.length) out.push(`Нет фото: ${noPhoto.map((i) => `«${i.productName || 'строка'}»`).join(', ')}`);
  if (!ctx.hasBlank) out.push('Нет бланка фирмы');
  if (items.length && !(Number(o.total) > 0)) out.push('Сумма КП равна нулю');
  if (o.validUntil && dayKey(o.validUntil) < dayKey(ctx.today)) out.push('Срок действия КП прошёл');
  return out;
}

const norm = (s: string | null | undefined) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export interface PackOffer { id: string; companyName?: string | null; customer?: string | null; problems: string[] }

/** Список для пакета: проблемы каждого КП с названием фирмы + «разные заказчики». */
export function packProblems(offers: PackOffer[]): string[] {
  const out: string[] = [];
  for (const o of offers) for (const p of o.problems) out.push(`${o.companyName || 'КП'}: ${p}`);
  const customers = new Set(offers.map((o) => norm(o.customer)));
  if (customers.size > 1) out.push('У КП пакета разные заказчики');
  return out;
}
