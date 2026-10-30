import { join } from 'path';
import PDFDocument from 'pdfkit';
import { fontDir } from '../product-passport/passport-pdf';

export interface TechSheetInput { title: string; rows: { name: string; text: string }[]; photo: Buffer | null }

const W = 595.28, H = 841.89, M = 40, PHOTO = 190, GAP = 14, NAME = 110, PAD = 5, BOTTOM = H - 40;

/** Техническое описание: А4, сверху название, слева фото, справа таблица «часть — описание»; длинная таблица переходит на следующий лист. */
export function renderTechSheetPdf(i: TechSheetInput): Promise<Buffer> {
  const d = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `Техническое описание: ${i.title}` } });
  d.registerFont('gost', join(fontDir(), 'gost-a.ttf'));
  const chunks: Buffer[] = [];
  d.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok, fail) => { d.on('end', () => ok(Buffer.concat(chunks))); d.on('error', fail); });

  d.font('gost').fontSize(13).fillColor('#000').text('Техническое описание', M, 36, { width: W - 2 * M, align: 'center' });
  d.fontSize(11).text(i.title, M, 56, { width: W - 2 * M, align: 'center' });
  const top = d.y + 12;
  if (i.photo) { try { d.image(i.photo, M, top, { fit: [PHOTO, PHOTO], align: 'center' }); } catch { /* файл фото не читается — документ без него */ } }

  const x0 = i.photo ? M + PHOTO + GAP : M;
  const x1 = x0 + NAME, right = W - M, textW = right - x1 - 2 * PAD;
  let y = top;
  const cell = (s: string, x: number, yy: number, w: number) => d.font('gost').fontSize(10).fillColor('#000').text(s, x + PAD, yy + PAD, { width: w });
  for (const r of i.rows) {
    d.font('gost').fontSize(10);
    const h = Math.max(d.heightOfString(r.name, { width: NAME - 2 * PAD }), d.heightOfString(r.text, { width: textW })) + 2 * PAD;
    if (y + h > BOTTOM) { d.addPage({ size: [W, H], margin: 0 }); y = 40; }
    d.lineWidth(0.5).strokeColor('#000').rect(x0, y, right - x0, h).stroke();
    d.moveTo(x1, y).lineTo(x1, y + h).stroke();
    cell(r.name, x0, y, NAME - 2 * PAD);
    cell(r.text, x1, y, textW);
    y += h;
  }
  d.end();
  return done;
}
