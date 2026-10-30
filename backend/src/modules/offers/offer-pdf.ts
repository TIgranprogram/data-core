import { join } from 'path';
import PDFDocument from 'pdfkit';
import { fontDir } from '../product-passport/passport-pdf';
import { PAGE_H as H, PAGE_W as W, paginateRows, placeBlock, zoneOf } from './offer-layout';

export interface OfferPdfInput {
  number: string;
  date: Date | string;
  validUntil?: Date | string | null;
  customer: string;
  companyName?: string;
  items: Array<{ productName: string; productSku?: string; description?: string; color?: string; size?: string; quantity: number; unit?: string; unitPrice?: number | null; total: number }>;
  total: number;
  prepaymentPercent?: number | null;
  productionDays?: number | null;
  deliveryDays?: number | null;
  terms?: string | null;
  notes?: string | null;
  /** Готовые JPEG фонов; null — белая страница. */
  bg1: Buffer | null;
  bg2: Buffer | null;
  /** Фото строк (JPEG) по индексу строки; нет — без фото. */
  photos: Map<number, Buffer>;
}

const ML = 40, CW = W - ML * 2;
const PHOTO = 36;

export const ruDate = (v?: Date | string | null) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
};
/** 12345.5 → «12 345,50». */
export const money = (n: number | null | undefined) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '';
  const [i, f] = (Math.round(Number(n) * 100) / 100).toFixed(2).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${f}`;
};
const qty = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

/** PDF КП: А4, фон 1 на стр. 1, фон 2 на стр. 2+; текст только в безопасных зонах (offer-layout). */
export function renderOfferPdf(i: OfferPdfInput): Promise<Buffer> {
  const dir = fontDir();
  const d = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `Коммерческое предложение № ${i.number}`, Author: i.companyName || '' } });
  d.registerFont('gost', join(dir, 'gost-a.ttf'));
  const chunks: Buffer[] = [];
  d.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok, fail) => { d.on('end', () => ok(Buffer.concat(chunks))); d.on('error', fail); });

  const hasPhoto = i.photos.size > 0;
  // колонки: №, [Фото], Наименование (остаток), Кол-во, Ед., Цена, Сумма
  const fixed = [24, ...(hasPhoto ? [PHOTO + 8] : []), 0, 44, 30, 62, 70];
  const nameIdx = hasPhoto ? 2 : 1;
  const widths = fixed.map((w) => w || CW - fixed.reduce((a, b) => a + b, 0));
  const xs = widths.reduce<number[]>((a, w, k) => [...a, k ? a[k - 1] + widths[k - 1] : ML], []);
  const HEAD = ['№', ...(hasPhoto ? ['Фото'] : []), 'Наименование', 'Кол-во', 'Ед.', 'Цена, руб.', 'Сумма, руб.'];
  const INK = '#111';

  let page = 0;
  const drawBg = (p: number) => { const bg = p === 0 ? i.bg1 : i.bg2; if (bg) d.image(bg, 0, 0, { width: W, height: H }); };
  const goto = (p: number) => { while (page < p) { d.addPage(); page += 1; drawBg(page); } };
  drawBg(0);

  const text = (s: string, x: number, y: number, o: { size?: number; width?: number; align?: 'left' | 'center' | 'right' } = {}) =>
    d.font('gost').fontSize(o.size ?? 10).fillColor(INK).text(s, x, y, { width: o.width ?? CW, align: o.align ?? 'left' });
  const hOf = (s: string, width: number, size: number) => d.font('gost').fontSize(size).heightOfString(s, { width });

  const nameText = (it: OfferPdfInput['items'][number]) => {
    const meta = [it.productSku ? `арт. ${it.productSku}` : '', it.color ? `цвет: ${it.color}` : '', it.size ? `размер: ${it.size}` : ''].filter(Boolean).join(', ');
    return { title: it.productName, sub: [meta, it.description ?? ''].filter(Boolean).join('\n') };
  };
  const heights = i.items.map((it, k) => {
    const n = nameText(it);
    const w = widths[nameIdx] - 6;
    const th = hOf(n.title, w, 9.5) + (n.sub ? hOf(n.sub, w, 8) + 1 : 0) + 8;
    return Math.max(th, i.photos.has(k) ? PHOTO + 8 : 0, 20);
  });

  // шапка КП на стр. 1
  const z0 = zoneOf(0);
  let y = z0.top;
  text(`№ ${i.number} от ${ruDate(i.date)}`, ML, y, { size: 13 });
  y = d.y + 4;
  text(`Для: ${i.customer}`, ML, y, { size: 10.5 });
  y = d.y + 3;
  if (i.validUntil) { text(`Действительно до ${ruDate(i.validUntil)}`, ML, y, { size: 10 }); y = d.y + 3; }
  y += 8;

  // блоки после таблицы
  const cond: string[] = [];
  const pre = Number(i.prepaymentPercent) || 0;
  if (pre > 0) cond.push(`Предоплата: ${qty(pre)} %`);
  if (Number(i.productionDays) > 0) cond.push(`Срок изготовления: ${i.productionDays} дн.`);
  if (Number(i.deliveryDays) > 0) cond.push(`Срок доставки: ${i.deliveryDays} дн.`);
  if (i.terms?.trim()) cond.push(i.terms.trim());
  const blocks = [...(cond.length ? [{ title: 'Условия', body: cond.join('\n') }] : []), ...(i.notes?.trim() ? [{ title: 'Примечание', body: i.notes.trim() }] : [])];

  const HEAD_H = 22, TAIL_H = 26;
  const { pages, endY } = paginateRows(heights, y, HEAD_H, TAIL_H);

  const lineAt = (yy: number, h: number) => {
    d.lineWidth(0.5).strokeColor('#555').rect(ML, yy, CW, h).stroke();
    xs.slice(1).forEach((x) => d.moveTo(x, yy).lineTo(x, yy + h).stroke());
  };
  pages.forEach((idxs, p) => {
    goto(p);
    let yy = p === 0 ? y : zoneOf(p).top;
    HEAD.forEach((c, k) => text(c, xs[k] + 3, yy + 6, { size: 8.5, width: widths[k] - 6, align: 'center' }));
    lineAt(yy, HEAD_H);
    yy += HEAD_H;
    for (const k of idxs) {
      const it = i.items[k], h = heights[k], n = nameText(it);
      let c = 0;
      text(String(k + 1), xs[c] + 3, yy + 5, { size: 9, width: widths[c] - 6, align: 'center' });
      if (hasPhoto) {
        c += 1;
        const ph = i.photos.get(k);
        if (ph) d.image(ph, xs[c] + 4, yy + 4, { fit: [PHOTO, PHOTO], align: 'center', valign: 'center' });
      }
      c += 1;
      text(n.title, xs[c] + 3, yy + 4, { size: 9.5, width: widths[c] - 6 });
      if (n.sub) text(n.sub, xs[c] + 3, d.y + 1, { size: 8, width: widths[c] - 6 });
      const right = [qty(it.quantity), it.unit || 'шт', it.unitPrice === null || it.unitPrice === undefined ? '—' : money(it.unitPrice), money(it.total)];
      right.forEach((s, j) => text(s, xs[c + 1 + j] + 3, yy + 5, { size: 9, width: widths[c + 1 + j] - 6, align: j === 2 || j === 3 ? 'right' : 'center' }));
      lineAt(yy, h);
      yy += h;
    }
  });

  // «Итого» и текстовые блоки — после последней строки, переносятся целиком
  let at = placeBlock(page, endY, TAIL_H);
  goto(at.page);
  text(`Итого: ${money(i.total)} руб.`, ML, at.y + 8, { size: 11.5, align: 'right' });
  let ty = at.y + TAIL_H + 6;
  for (const b of blocks) {
    // заголовок + первая строка вместе, дальше абзацы по одному — длинный текст переносится, зону не пересекает
    const [first, ...rest] = b.body.split('\n');
    at = placeBlock(page, ty, hOf(b.title, CW, 10) + hOf(first, CW, 9.5) + 6);
    goto(at.page);
    text(b.title, ML, at.y, { size: 10 });
    text(first, ML, d.y + 2, { size: 9.5 });
    ty = d.y + 2;
    for (const line of rest) {
      at = placeBlock(page, ty, hOf(line, CW, 9.5) + 2);
      goto(at.page);
      text(line, ML, at.y, { size: 9.5 });
      ty = d.y + 2;
    }
    ty += 6;
  }
  d.end();
  return done;
}
