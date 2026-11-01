import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { guardDoc } from '../../common/print/safe-doc';
import { fontDir } from '../product-passport/passport-pdf';
import { qrUrl } from './qr-code';
import { join } from 'path';

export interface Sticker { code: string; name: string; article: string | null }

const MM = 72 / 25.4;
const CELL = 38 * MM, MARGIN = 8 * MM, QR = 25 * MM, QUIET = 2 * MM;
export const COLS = 5, ROWS = 7, PER_PAGE = COLS * ROWS;
const A4: [number, number] = [595.28, 841.89];

/** Число листов для n наклеек при пропуске skip ячеек. */
export const pagesFor = (n: number, skip = 0) => Math.max(1, Math.ceil((n + skip) / PER_PAGE));

function cut(s: string, max: number): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Лист наклеек: QR 25×25 мм (вектор, уровень M), тихая зона 2 мм, подпись 2 строки 7 pt,
 * ячейка 38×38, поля 8 мм → 5×7 = 35 на А4, линии реза пунктиром. skip — занятые ячейки начатого листа.
 */
export function renderQrSheet(stickers: Sticker[], skip = 0): Promise<Buffer> {
  const doc = guardDoc(new PDFDocument({ size: A4, margin: 0, info: { Title: 'QR-наклейки' } }), 'QR-наклейки');
  doc.registerFont('gost', join(fontDir(), 'gost-a.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res, rej) => { doc.on('end', () => res(Buffer.concat(chunks))); doc.on('error', rej); });

  const total = pagesFor(stickers.length, skip) * PER_PAGE;
  for (let slot = 0; slot < total; slot++) {
    if (slot % PER_PAGE === 0) {
      if (slot) doc.addPage();
      cutLines(doc);
    }
    const s = stickers[slot - skip];
    if (!s) continue;
    const k = slot % PER_PAGE;
    const x = MARGIN + (k % COLS) * CELL, y = MARGIN + Math.floor(k / COLS) * CELL;
    const m = QRCode.create(qrUrl(s.code), { errorCorrectionLevel: 'M' }).modules;
    const unit = (QR - 0) / m.size;
    const qx = x + (CELL - QR) / 2, qy = y + QUIET;
    doc.fillColor('#000');
    for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) doc.rect(qx + c * unit, qy + r * unit, unit + 0.02, unit + 0.02).fill();
    doc.font('gost').fontSize(7).fillColor('#000');
    const ty = qy + QR + QUIET;
    doc.text(cut(s.name, 28), x + 2, ty, { width: CELL - 4, height: 8.5, lineBreak: false, align: 'center' });
    doc.text(cut(s.article ? `${s.article} · ${s.code}` : s.code, 34), x + 2, ty + 8.5, { width: CELL - 4, height: 8.5, lineBreak: false, align: 'center' });
  }
  doc.end();
  return done;
}

function cutLines(doc: PDFKit.PDFDocument) {
  doc.save().lineWidth(0.3).strokeColor('#999').dash(2, { space: 2 });
  for (let i = 0; i <= COLS; i++) doc.moveTo(MARGIN + i * CELL, MARGIN).lineTo(MARGIN + i * CELL, MARGIN + ROWS * CELL).stroke();
  for (let j = 0; j <= ROWS; j++) doc.moveTo(MARGIN, MARGIN + j * CELL).lineTo(MARGIN + COLS * CELL, MARGIN + j * CELL).stroke();
  doc.undash().restore();
}
