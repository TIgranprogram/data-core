import { join } from 'path';
import PDFDocument from 'pdfkit';
import { fontDir } from '../product-passport/passport-pdf';

/** Данные печатной формы «Накладная на отгрузку» (внутренний документ, не УПД/ТОРГ-12). */
export interface ShipmentPdfInput {
  number: string;
  date: Date | string;
  orderNo: string;
  orderDate?: Date | string;
  org: { name: string; inn?: string; address?: string; phone?: string };
  customer: { name: string; inn?: string; address?: string };
  rows: Array<{ n: number; title: string; article: string; unit: string; ordered: number; now: number; after: number }>;
  reason?: string; note?: string; docNo?: string; receiver?: string; whoName?: string;
}

const W = 595.28, H = 841.89, ML = 40, MR = 40, MT = 40, MB = 40;
const CW = W - ML - MR;
const COLS = [24, 0, 70, 32, 50, 56, 52]; // 0 — остаток ширины под наименование
const HEAD = ['№', 'Наименование', 'Артикул', 'Ед.', 'В заказе', 'Отгружено сейчас', 'Остаток после'];
const ROW_H = 22;

const ruDate = (v?: Date | string) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
};
const num = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

/** PDF отгрузки: А4, только чёрный цвет, без заливок; таблица переносится на следующую страницу. */
export function renderShipmentPdf(i: ShipmentPdfInput): Promise<Buffer> {
  const dir = fontDir();
  const d = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `Накладная на отгрузку № ${i.number}`, Author: i.org.name } });
  d.registerFont('gost', join(dir, 'gost-a.ttf'));
  d.registerFont('gost-i', join(dir, 'gost-a-slanted.ttf'));
  const chunks: Buffer[] = [];
  d.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok, fail) => { d.on('end', () => ok(Buffer.concat(chunks))); d.on('error', fail); });

  const widths = COLS.map((w) => w || CW - COLS.reduce((a, b) => a + b, 0));
  const xs = widths.reduce<number[]>((a, w, k) => [...a, k ? a[k - 1] + widths[k - 1] : ML], []);
  const txt = (s: string, x: number, y: number, o: PDFKit.Mixins.TextOptions & { size?: number } = {}) => d.font('gost').fontSize(o.size ?? 10).fillColor('#000').text(s, x, y, { lineBreak: false, ...o });
  const line = (y: number) => d.lineWidth(0.5).strokeColor('#000').moveTo(ML, y).lineTo(W - MR, y).stroke();

  const row = (cells: string[], y: number, head = false) => {
    cells.forEach((c, k) => {
      const al = k === 1 || k === 2 ? 'left' : 'center';
      d.font('gost').fontSize(head ? 8.5 : 9.5).fillColor('#000').text(c, xs[k] + 3, y + (head ? 4 : 6), { width: widths[k] - 6, height: ROW_H - 4, align: al, ellipsis: true, lineGap: -1 });
    });
    d.lineWidth(0.5).strokeColor('#000').rect(ML, y, CW, ROW_H).stroke();
    xs.slice(1).forEach((x) => d.moveTo(x, y).lineTo(x, y + ROW_H).stroke());
  };

  let y = MT;
  txt(i.org.name || '—', ML, y, { width: CW, size: 12 });
  y += 17;
  const orgLine = [i.org.inn ? `ИНН ${i.org.inn}` : '', i.org.address ?? '', i.org.phone ? `тел. ${i.org.phone}` : ''].filter(Boolean).join(', ');
  if (orgLine) { d.font('gost').fontSize(9).text(orgLine, ML, y, { width: CW }); y = d.y + 6; }
  line(y); y += 12;
  txt(`Накладная на отгрузку № ${i.number} от ${ruDate(i.date)}`, ML, y, { width: CW, size: 14, align: 'center' });
  y += 24;
  const info = (label: string, v: string) => {
    if (!v) return;
    d.font('gost').fontSize(10).fillColor('#000').text(`${label} ${v}`, ML, y, { width: CW });
    y = d.y + 3;
  };
  info('Заказ №', `${i.orderNo}${i.orderDate ? ` от ${ruDate(i.orderDate)}` : ''}`);
  info('Заказчик:', [i.customer.name, i.customer.inn ? `ИНН ${i.customer.inn}` : '', i.customer.address ?? ''].filter(Boolean).join(', '));
  info('Документ:', i.docNo ?? '');
  y += 8;

  const header = () => { row(HEAD, y, true); y += ROW_H; };
  header();
  for (const r of i.rows) {
    if (y + ROW_H > H - MB - 160) { d.addPage(); y = MT; header(); }
    row([String(r.n), r.title, r.article, r.unit, r.ordered ? num(r.ordered) : '', num(r.now), num(r.after)], y);
    y += ROW_H;
  }
  const total = i.rows.reduce((a, r) => a + r.now, 0);
  y += 8;
  txt(`Итого отгружено: ${num(total)} (позиций: ${i.rows.length})`, ML, y, { width: CW, size: 10.5 });
  y += 20;
  if (i.reason) info('Причина частичной отгрузки:', i.reason);
  if (i.note) info('Примечание:', i.note);
  if (i.receiver) info('Принял (по документам):', i.receiver);

  // подписи — внизу последней страницы блока; не помещаются — на новую страницу
  if (y + 110 > H - MB) { d.addPage(); y = MT; }
  y += 24;
  const sign = (label: string, fio: string, x: number, w: number) => {
    d.font('gost').fontSize(10).fillColor('#000').text(label, x, y, { lineBreak: false });
    const lx = x + d.widthOfString(label) + 6;
    d.lineWidth(0.5).moveTo(lx, y + 11).lineTo(lx + 70, y + 11).stroke();
    d.font('gost').fontSize(9).text(fio || '', lx + 76, y + 1, { width: w - (lx - x) - 76, height: 12, ellipsis: true, lineBreak: false });
    d.font('gost').fontSize(7.5).text('подпись / ФИО', lx, y + 14, { lineBreak: false });
  };
  const half = CW / 2 - 10;
  sign('Отпустил', i.whoName ?? '', ML, half);
  sign('Принял', i.receiver ?? '', ML + half + 20, half);
  y += 44;
  txt(`Дата ${ruDate(i.date)}`, ML, y, { size: 10 });
  txt('М.П.', ML + half + 20, y, { size: 10 });
  d.end();
  return done;
}
