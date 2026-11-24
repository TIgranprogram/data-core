import { BadRequestException } from '@nestjs/common';
import { OfferGeometry } from './offer-geometry';
import { OFFER_BLOCKS, type OfferBlock, type OfferLayoutDto } from './dto';
import { guardDoc } from '../../common/print/safe-doc';
import { existsSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { fontDir } from '../../common/print/font-dir';

/** Кандидаты шрифтов: сначала системный sans-serif с кириллицей (Ubuntu), затем ГОСТ. */
function offerBoldPath(dir: string): string {
  for (const p of ['/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']) {
    if (existsSync(p)) return p;
  }
  return offerFontPath(dir);
}
function offerFontPath(dir: string): string {
  for (const p of ['/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/freefont/FreeSans.ttf']) {
    if (existsSync(p)) return p;
  }
  return join(dir, 'gost-a.ttf');
}
import { PAGE_H as H, PAGE_W as W, paginateRows, placeBlock, zoneOf, type Zones } from './offer-layout';
import { validDays, vatAmount, type VatMode } from './offer-rules';

export interface OfferPageMap { count: number; blocks: Record<string, number>; rows: number[] }
export const newOfferPageMap = (): OfferPageMap => ({ count: 1, blocks: { document: 1 }, rows: [] });

export interface OfferPdfInput {
  pageMap?: OfferPageMap;
  geometry?: OfferGeometry;
  number: string;
  date: Date | string;
  validUntil?: Date | string | null;
  customer: string;
  /** Объект — под заказчиком, жирным. */
  objectName?: string | null;
  /** Черновик (предпросмотр): номер печатается без «№». */
  draft?: boolean;
  vatMode: VatMode;
  vatRate: number;
  delivery?: 'included' | 'excluded' | null;
  companyName?: string;
  layout?: OfferLayoutDto;
  items: Array<{ photoMm?: number; rowMm?: number; pageBreakBefore?: boolean; productName: string; productSku?: string; description?: string; color?: string; size?: string; quantity: number; unit?: string; unitPrice?: number | null; total: number }>;
  total: number;
  prepaymentPercent?: number | null;
  productionDays?: number | null;
  deliveryDays?: number | null;
  terms?: string | null;
  notes?: string | null;
  /** Готовые JPEG фонов; null — белая страница. */
  bg1: Buffer | null;
  bg2: Buffer | null;
  /** Зоны текста бланков (доли высоты); пусто — по умолчанию. */
  zones?: Zones;
  /** Фото строк (JPEG) по индексу строки; нет — без фото. */
  photos: Map<number, Buffer>;
}

// PDFKit принимает уже открытое изображение, его публичные TypeScript-типы описывают только Buffer/путь.
interface OpenImage { width: number; height: number }
type ImageDoc = PDFKit.PDFDocument & {
  openImage(src: Buffer): OpenImage;
  image(src: OpenImage, x: number, y: number, options: PDFKit.Mixins.ImageOption): void;
};

const ML = 40, CW = W - ML * 2;
/** Фото строки: до 4 строк — крупнее (80 pt), больше — 48 pt. */
const photoSize = (rows: number) => (rows <= 4 ? 80 : 48);

export const ruDate = (v?: Date | string | null) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
};
/** Рубли для итога: целое — без копеек («680 000 ₽»), иначе «122 622,95 ₽». */
export const rub = (n: number) => {
  const r = Math.round(Number(n) * 100) / 100;
  const t = money(r);
  return `${Number.isInteger(r) ? t.replace(/,00$/, '') : t} ₽`;
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
  const d = guardDoc(new PDFDocument({ size: [W, H], margin: 0, info: { Title: `Коммерческое предложение № ${i.number}`, Author: i.companyName || '' } }), 'КП');
  d.registerFont('gost', offerFontPath(dir));
  d.registerFont('gostb', offerBoldPath(dir));
  const chunks: Buffer[] = [];
  d.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok, fail) => { d.on('end', () => ok(Buffer.concat(chunks))); d.on('error', fail); });

  const hasPhoto = i.photos.size > 0;
  const pt = (mm: number) => mm * 72 / 25.4;
  const tableWidth = i.layout?.tableWidthMm ? pt(i.layout.tableWidthMm) : CW;
  const tableLeft = ML + (CW - tableWidth) / 2;
  const imageSizes = i.items.map((row, index) => i.photos.has(index) ? (row.photoMm ? pt(row.photoMm) : photoSize(i.items.length)) : 0);
  const PHOTO = Math.max(0, ...imageSizes);
  const zones = i.zones;
  // колонки: №, [Фото], Наименование (остаток), Кол-во, Ед., Цена, Сумма
  const fixed = [24, ...(hasPhoto ? [PHOTO + 8] : []), 0, 44, 30, 62, 70];
  const nameIdx = hasPhoto ? 2 : 1;
  const widths = fixed.map((w) => w || tableWidth - fixed.reduce((a, b) => a + b, 0));
  const xs = widths.reduce<number[]>((a, w, k) => [...a, k ? a[k - 1] + widths[k - 1] : tableLeft], []);
  const HEAD = ['№', ...(hasPhoto ? ['Фото'] : []), 'Наименование', 'Кол-во', 'Ед.', 'Цена, руб.', 'Сумма, руб.'];
  const INK = '#111';

  const map = i.pageMap;
  const geo = i.geometry;
  let page = 0;
  const drawBg = (p: number) => { const bg = p === 0 ? i.bg1 : i.bg2; if (bg) d.image(bg, 0, 0, { width: W, height: H }); };
  const goto = (p: number) => { while (page < p) { d.addPage(); page += 1; if (map) map.count = page + 1; if (geo) geo.pages[page] = []; drawBg(page); } };
  drawBg(0);

  let dx = pt(i.layout?.header?.xMm || 0);
  const text = (s: string, x: number, y: number, o: { size?: number; width?: number; align?: 'left' | 'center' | 'right'; bold?: boolean; color?: string } = {}) =>
    d.font(o.bold ? 'gostb' : 'gost').fontSize(o.size ?? 10).fillColor(o.color ?? INK).text(s, x + dx, y, { width: o.width ?? CW, align: o.align ?? 'left' });
  function hitText(key: string, value: string, x: number, top: number, width = CW, right = false) {
    if (!geo) return;
    const height = d.y - top;
    const measured = Math.min(width, Math.max(...value.split('\n').map((line) => d.widthOfString(line))));
    geo.span(page, key, dx + x + (right ? width - measured : 0), top, measured, height);
  }
  const hOf = (s: string, width: number, size: number, bold = false) => d.font(bold ? 'gostb' : 'gost').fontSize(size).heightOfString(s, { width });

  const nameText = (it: OfferPdfInput['items'][number]) => {
    const meta = [it.productSku ? `арт. ${it.productSku}` : '', it.color ? `цвет: ${it.color}` : '', it.size ? `размер: ${it.size}` : ''].filter(Boolean).join(', ');
    return { title: it.productName, sub: [meta, it.description ?? ''].filter(Boolean).join('\n') };
  };
  const heights = i.items.map((it, k) => {
    const n = nameText(it);
    const w = widths[nameIdx] - 6;
    const th = hOf(n.title, w, 9.5) + (n.sub ? hOf(n.sub, w, 8) + 1 : 0) + 8;
    return Math.max(th, imageSizes[k] + 8, it.rowMm ? pt(it.rowMm) : 20);
  });

  // шапка КП на стр. 1
  const z0 = zoneOf(0, zones);
  let y = z0.top + pt(i.layout?.header?.gapMm || 0);
  text(i.draft ? i.number : `№ ${i.number}`, ML, y, { size: 13, width: CW / 2 });
  const date = `Дата: ${ruDate(i.date)}`;
  text(date, ML + CW / 2, y, { size: 11, width: CW / 2, align: 'right' });
  hitText('date', date, ML + CW / 2, y, CW / 2, true);
  y += 20;
  text(`Заказчик: ${i.customer}`, ML, y, { size: 10.5 });
  hitText('customer', `Заказчик: ${i.customer}`, ML, y);
  y = d.y + 3;
  if (i.objectName?.trim()) {
    const object = `Объект: ${i.objectName.trim()}`;
    text(object, ML, y, { size: 10.5, bold: true });
    hitText('objectName', object, ML, y);
    y = d.y + 3;
  }
  y += 8;

  // блоки после таблицы
  const cond: string[] = [];
  const pre = Number(i.prepaymentPercent) || 0;
  if (pre > 0) cond.push(`Предоплата: ${qty(pre)} %`);
  if (Number(i.productionDays) > 0) cond.push(`Срок изготовления: ${i.productionDays} дн.`);
  if (Number(i.deliveryDays) > 0) cond.push(`Срок доставки: ${i.deliveryDays} дн.`);
  if (i.terms?.trim()) cond.push(i.terms.trim());
  // справочные строки (серым): доставка, срок действия, цены и НДС — строятся из полей КП
  const days = validDays(i.date, i.validUntil);
  const info = [
    ...(i.delivery === 'included' ? ['Доставка до объекта включена в стоимость.'] : i.delivery === 'excluded' ? ['Доставка до объекта в стоимость не входит.'] : []),
    ...(days ? [`Срок действия коммерческого предложения — ${days} календарных дней.`] : []),
    i.vatMode === 'with' ? `Цены указаны в рублях РФ, с НДС ${qty(i.vatRate)} % (НДС включён в стоимость).` : 'Цены указаны в рублях РФ, без НДС.',
  ];
  const HEAD_H = 22, TAIL_H = 46;
  const breaks = new Set(i.items.flatMap((row, index) => row.pageBreakBefore ? [index] : []));

  const lineAt = (yy: number, h: number) => {
    d.lineWidth(0.5).strokeColor('#555').rect(tableLeft + dx, yy, tableWidth, h).stroke();
    xs.slice(1).forEach((x) => d.moveTo(x + dx, yy).lineTo(x + dx, yy + h).stroke());
  };
  function drawTable() {
    const startPage = page;
    const { pages, endY } = paginateRows(heights, y, HEAD_H, TAIL_H, zones, startPage, breaks);
    pages.forEach((idxs, p) => {
      if (!idxs.length) return;
      goto(startPage + p);
      if (map && map.blocks.table == null) map.blocks.table = page + 1;
      let yy = p === 0 ? y : zoneOf(page, zones).top;
      geo?.add(page, 'table', tableLeft + dx, yy, tableWidth, HEAD_H + idxs.reduce((sum, k) => sum + heights[k], 0));
      HEAD.forEach((c, k) => text(c, xs[k] + 3, yy + 6, { size: 8.5, width: widths[k] - 6, align: 'center' }));
      lineAt(yy, HEAD_H);
      yy += HEAD_H;
      for (const k of idxs) {
        if (map) map.rows[k] = page + 1;
        if (yy + heights[k] > zoneOf(page, zones).bottom + 0.01) throw new BadRequestException('Строка ' + (k + 1) + ' не помещается на бланке. Уменьшите высоту, фотографию или описание.');
        const it = i.items[k], h = heights[k], n = nameText(it);
        geo?.add(page, 'row', tableLeft + dx, yy, tableWidth, h, k);
        let c = 0;
        text(String(k + 1), xs[c] + 3, yy + 5, { size: 9, width: widths[c] - 6, align: 'center' });
        if (hasPhoto) {
          c += 1;
          const ph = i.photos.get(k);
          if (ph) {
            const doc = d as ImageDoc;
            const image = doc.openImage(ph);
            const scale = imageSizes[k] / Math.max(image.width, image.height);
            const width = image.width * scale, height = image.height * scale;
            const x = dx + xs[c] + (widths[c] - width) / 2, top = yy + (h - height) / 2;
            doc.image(image, x, top, { width, height });
            geo?.add(page, 'photo', x, top, width, height, k);
          }
        }
        c += 1;
        text(n.title, xs[c] + 3, yy + 4, { size: 9.5, width: widths[c] - 6 });
        const subTop = d.y + 1;
        geo?.add(page, 'productName', dx + xs[c], yy, widths[c], n.sub ? subTop - yy : h, k);
        if (n.sub) {
          text(n.sub, xs[c] + 3, subTop, { size: 8, width: widths[c] - 6 });
          if (geo && it.description) {
            const bottom = d.y;
            const meta = n.sub.slice(0, n.sub.length - it.description.length).trimEnd();
            const top = subTop + (meta ? hOf(meta, widths[c] - 6, 8) : 0);
            geo.add(page, 'description', dx + xs[c], top, widths[c], bottom - top, k);
          }
        }
        const right = [qty(it.quantity), it.unit || 'шт', it.unitPrice === null || it.unitPrice === undefined ? '—' : money(it.unitPrice), money(it.total)];
        right.forEach((s, j) => text(s, xs[c + 1 + j] + 3, yy + 5, { size: 9, width: widths[c + 1 + j] - 6, align: j === 2 || j === 3 ? 'right' : 'center' }));
        ['quantity', 'unit', 'unitPrice', 'total'].forEach((key, j) => geo?.add(page, key, dx + xs[c + 1 + j], yy, widths[c + 1 + j], h, k));
        lineAt(yy, h);
        yy += h;
      }
    });

    // «Итого» и текстовые блоки — после последней строки, переносятся целиком
    const at = placeBlock(startPage + pages.length - 1, endY, TAIL_H, zones);
    goto(at.page);
    text(`Итого: ${rub(i.total)}`, tableLeft, at.y + 8, { width: tableWidth, size: 13, bold: true, align: 'right' });
    text(i.vatMode === 'with' ? `в том числе НДС ${qty(i.vatRate)} %: ${rub(vatAmount(i.total, i.vatRate))}` : 'Без НДС', tableLeft, d.y + 3, { width: tableWidth, size: 9.5, align: 'right' });
    geo?.add(page, 'total', tableLeft + dx, at.y + 8, tableWidth, d.y - at.y - 8);
    y = at.y + TAIL_H + 6;
  }

  // Делим длинные абзацы по реально измеренным строкам, в том числе на узком бланке.
  function paragraph(key: string, value: string, size: number, color?: string) {
    let rest = value;
    while (rest) {
      const where = placeBlock(page, y, hOf('Я', CW, size), zones);
      goto(where.page);
      y = where.y;
      const room = zoneOf(page, zones).bottom - y;
      let end = rest.length;
      if (hOf(rest, CW, size) > room) {
        let lo = 0, hi = end;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (hOf(rest.slice(0, mid), CW, size) <= room) lo = mid;
          else hi = mid - 1;
        }
        if (!lo) throw new BadRequestException('Недостаточно места для текста на бланке');
        const word = rest.slice(0, lo).search(/\s+\S*$/u);
        end = word > 0 ? word : lo;
      }
      text(rest.slice(0, end), ML, y, { size, color });
      hitText(key, rest.slice(0, end), ML, y);
      if (map && map.blocks[key] == null) map.blocks[key] = page + 1;
      y = d.y + 2;
      rest = rest.slice(end).trimStart();
      if (rest) { goto(page + 1); y = zoneOf(page, zones).top; }
    }
  }

  for (const block of i.layout?.blocks || OFFER_BLOCKS) {
    if ((block === 'terms' && !cond.length) || (block === 'notes' && !i.notes?.trim())) continue;
    const free = i.layout?.texts?.find((t) => block === 'text:' + t.id);
    const position = free || i.layout?.[block as OfferBlock];
    dx = pt(position?.xMm || 0);
    y += pt(position?.gapMm || 0);
    if (free) {
      paragraph(block, free.text.trim(), 10);
      y += 6;
      continue;
    }
    if (block === 'table') { drawTable(); continue; }
    if (block === 'info') {
      if (map) map.blocks.info = placeBlock(page, y, hOf('Я', CW, 9), zones).page + 1;
      info.forEach((line) => paragraph(block, line, 9, '#555'));
      y += 4;
      continue;
    }
    const body = block === 'terms' ? cond.join('\n') : i.notes?.trim();
    if (!body) continue;
    const heading = block === 'terms' ? 'Условия' : 'Примечание';
    const at = placeBlock(page, y, hOf(heading, CW, 10) + hOf('Я', CW, 9.5) + 4, zones);
    goto(at.page);
    if (map) map.blocks[block] = page + 1;
    text(heading, ML, at.y, { size: 10 });
    hitText(block, heading, ML, at.y);
    y = d.y + 2;
    body.split('\n').forEach((line) => paragraph(block, line, 9.5));
    y += 6;
  }
  d.end();
  return done;
}
