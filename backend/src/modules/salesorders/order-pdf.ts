import { existsSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { guardDoc } from '../../common/print/safe-doc';
import { fontDir } from '../product-passport/passport-pdf';

/**
 * Печать заказа для производства (пользователь 2026-11-06: «с картинками, без цен, больше информации — именно процессы
 * производства»). А4: шапка компании с логотипом; «Заказ № …», сроки, приоритет, сводка по процессам;
 * по каждому договору — плашка и карточки позиций: фото, название, количество, артикул/цвет/размер/отгрузка,
 * маршрут изготовления с текущим шагом, проектирование (статус, исполнитель), примечание. Цен нет. Внизу — «стр. X из Y».
 */
export interface OrderPdfStep { name: string; state: 'done' | 'now' | 'next' }
export interface OrderPdfLine {
  seqNo?: number | null; title: string; qty?: number; unit?: string; facts?: string[];
  photo?: Buffer; route?: OrderPdfStep[]; workText?: string; designText?: string; note?: string;
}
export interface OrderPdfContract { orderNo: string; contractDate?: Date | string | null; customer?: string; title?: string; stageLabel?: string; lines: OrderPdfLine[] }
export interface OrderPdfInput {
  number: string; stageLabel?: string; customer?: string; priority?: string; notes?: string;
  productionDeadline?: Date | string | null; shipDate?: Date | string | null;
  org: { name: string; inn?: string; address?: string; phone?: string };
  logo?: Buffer; contracts: OrderPdfContract[]; summary?: string; printedAt?: Date;
}

const W = 595.28, H = 841.89, ML = 36, MR = 36, MT = 36, MB = 44;
const CW = W - ML - MR;
const INK = '#111111', MUTED = '#5a5a5a', FAINT = '#9a9a9a', RULE = '#c4c4c4', BAND = '#ececec';
const PH = 66; // сторона фото позиции

/** Обычный шрифт документа (как у КП): DejaVu Sans на сервере; на ПК — Segoe UI; нет — ГОСТ. */
const pick = (list: string[], fallback: string) => list.find((p) => existsSync(p)) ?? fallback;
export const orderFonts = (dir: string) => ({
  regular: pick(['/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/freefont/FreeSans.ttf', 'C:/Windows/Fonts/segoeui.ttf'], join(dir, 'gost-a.ttf')),
  bold: pick(['/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf', 'C:/Windows/Fonts/segoeuib.ttf'], join(dir, 'gost-a.ttf')),
});

export const ruDate = (v?: Date | string | null) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
};
export const ruNum = (n?: number) => (n === undefined || n === null || !Number.isFinite(n) ? '' : String(Math.round(n * 1000) / 1000).replace('.', ','));

/** Маршрут одной строкой: «Сварка → Покраска (сейчас) → Сборка». */
export const routeText = (route: OrderPdfStep[] = []) => route.map((s) => s.name + (s.state === 'now' ? ' (сейчас)' : '')).join('  →  ');

export function renderOrderPdf(i: OrderPdfInput): Promise<Buffer> {
  const dir = fontDir();
  const d = guardDoc(new PDFDocument({ size: [W, H], margin: 0, bufferPages: true, info: { Title: `Заказ № ${i.number}`, Author: i.org.name || 'Рабочее место' } }), 'Заказ');
  const ff = orderFonts(dir);
  d.registerFont('reg', ff.regular);
  d.registerFont('bold', ff.bold);
  const chunks: Buffer[] = [];
  d.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok, fail) => { d.on('end', () => ok(Buffer.concat(chunks))); d.on('error', fail); });

  const reg = (size: number, color = INK) => d.font('reg').fontSize(size).fillColor(color);
  const bold = (size: number, color = INK) => d.font('bold').fontSize(size).fillColor(color);
  const rule = (y: number, color = RULE, w = 0.5) => d.lineWidth(w).strokeColor(color).moveTo(ML, y).lineTo(W - MR, y).stroke();
  let y = MT;
  const room = (h: number) => { if (y + h > H - MB) { d.addPage(); y = MT; } };

  // ---------- шапка компании ----------
  let tx = ML;
  if (i.logo) { try { d.image(i.logo, ML, y, { fit: [96, 44], valign: 'center' }); tx = ML + 108; } catch { /* без логотипа */ } }
  bold(12.5).text(i.org.name || 'Наша компания', tx, y + 2, { width: W - MR - tx, lineBreak: false, ellipsis: true });
  const orgLine = [i.org.inn ? `ИНН ${i.org.inn}` : '', i.org.address ?? '', i.org.phone ? `тел. ${i.org.phone}` : ''].filter(Boolean).join(' · ');
  if (orgLine) reg(8.5, MUTED).text(orgLine, tx, y + 20, { width: W - MR - tx, height: 24, ellipsis: true });
  y += 52; rule(y, INK, 1); y += 14;

  // ---------- заголовок и сводка ----------
  bold(19).text(`Заказ № ${i.number}`, ML, y, { width: CW * 0.6, lineBreak: false });
  reg(9, MUTED).text('Производственный лист', ML + CW * 0.6, y + 1, { width: CW * 0.4, align: 'right', lineBreak: false });
  if (i.stageLabel) bold(10.5).text(i.stageLabel, ML + CW * 0.6, y + 14, { width: CW * 0.4, align: 'right', lineBreak: false });
  y += 32;
  const facts = [i.customer ? `Заказчик: ${i.customer}` : '', i.priority ? `Приоритет: ${i.priority}` : '',
    i.productionDeadline ? `Срок изготовления: ${ruDate(i.productionDeadline)}` : '', i.shipDate ? `Отгрузка: ${ruDate(i.shipDate)}` : ''].filter(Boolean);
  if (facts.length) { reg(9.5).text(facts.join('   ·   '), ML, y, { width: CW }); y = d.y + 6; }
  if (i.summary) { bold(9.5).text(i.summary, ML, y, { width: CW }); y = d.y + 6; }
  if (i.notes) { reg(9, MUTED).text(`Примечание: ${i.notes}`, ML, y, { width: CW, height: 40, ellipsis: true }); y = d.y + 6; }
  y += 6;

  // ---------- позиции ----------
  const TX = ML + PH + 12, TW = W - MR - TX;
  const routeLine = (l: OrderPdfLine) => 'Маршрут: ' + (l.route?.length ? routeText(l.route) : l.workText || 'не задан');
  const lineHeight = (l: OrderPdfLine) => {
    let h = 4 + Math.max(14, bold(10.5).heightOfString(`${l.seqNo ?? ''}. ${l.title || '—'}`, { width: TW - 76 })) + 3;
    if (l.facts?.length) h += reg(8.5).heightOfString(l.facts.join(' · '), { width: TW }) + 3;
    h += reg(8.5).heightOfString(routeLine(l), { width: TW }) + 3;
    if (l.designText) h += reg(8.5).heightOfString(l.designText, { width: TW }) + 3;
    if (l.note) h += Math.min(reg(8.5).heightOfString(l.note, { width: TW }), 34) + 3;
    return Math.max(PH + 12, h + 8);
  };
  for (const c of i.contracts) {
    room(30 + (c.lines[0] ? lineHeight(c.lines[0]) : 20));
    d.rect(ML, y, CW, 24).fill(BAND);
    const head = [`Договор № ${c.orderNo || '—'}${c.contractDate ? ` от ${ruDate(c.contractDate)}` : ''}`, c.customer, c.title].filter(Boolean).join('  ·  ');
    bold(9.5).text(head, ML + 8, y + 7.5, { width: CW - 16 - (c.stageLabel ? 110 : 0), lineBreak: false, ellipsis: true });
    if (c.stageLabel) reg(8.5, MUTED).text(c.stageLabel, W - MR - 118, y + 8, { width: 110, align: 'right', lineBreak: false });
    y += 30;
    if (!c.lines.length) { reg(9, MUTED).text('Позиций нет', ML + 8, y, { lineBreak: false }); y += 22; continue; }
    for (const l of c.lines) {
      const h = lineHeight(l);
      room(h);
      const top = y;
      d.lineWidth(0.5).strokeColor(RULE).roundedRect(ML, top + 4, PH, PH, 4).stroke();
      let pic = false;
      if (l.photo) { try { d.image(l.photo, ML + 2, top + 6, { fit: [PH - 4, PH - 4], align: 'center', valign: 'center' }); pic = true; } catch { pic = false; } }
      if (!pic) reg(7, FAINT).text('нет фото', ML, top + 4 + PH / 2 - 4, { width: PH, align: 'center', lineBreak: false });
      let ty = top + 4;
      bold(10.5).text(`${l.seqNo != null ? l.seqNo + '. ' : ''}${l.title || '—'}`, TX, ty, { width: TW - 76 });
      const after = d.y;
      bold(12).text(`${ruNum(l.qty)} ${l.unit ?? ''}`.trim(), W - MR - 72, ty - 1, { width: 72, align: 'right', lineBreak: false });
      ty = Math.max(after, ty + 14) + 3;
      if (l.facts?.length) { reg(8.5, MUTED).text(l.facts.join(' · '), TX, ty, { width: TW }); ty = d.y + 3; }
      // маршрут: сделанные шаги — серым, текущий — жирным, дальше — обычным
      if (l.route?.length) {
        reg(8.5, MUTED).text('Маршрут: ', TX, ty, { width: TW, continued: true });
        l.route.forEach((s, k) => {
          const last = k === l.route!.length - 1;
          (s.state === 'now' ? bold(8.5, INK) : reg(8.5, s.state === 'done' ? FAINT : INK)).text(s.name + (s.state === 'now' ? ' (сейчас)' : '') + (last ? '' : '  →  '), { continued: !last });
        });
      } else reg(8.5, MUTED).text(routeLine(l), TX, ty, { width: TW });
      ty = d.y + 3;
      if (l.designText) { reg(8.5, INK).text(l.designText, TX, ty, { width: TW }); ty = d.y + 3; }
      if (l.note) { reg(8.5, MUTED).text(l.note, TX, ty, { width: TW, height: 34, ellipsis: true }); }
      y = top + h;
      rule(y);
    }
    y += 10;
  }

  // ---------- подвал ----------
  const at = i.printedAt ?? new Date();
  const stamp = `${ruDate(at)} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const range = d.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    d.switchToPage(p);
    d.lineWidth(0.5).strokeColor(RULE).moveTo(ML, H - 30).lineTo(W - MR, H - 30).stroke();
    reg(7.5, MUTED).text(`Заказ № ${i.number} · производственный лист · сформировано ${stamp}`, ML, H - 24, { width: CW * 0.7, lineBreak: false });
    reg(7.5, MUTED).text(`стр. ${p - range.start + 1} из ${range.count}`, ML + CW * 0.7, H - 24, { width: CW * 0.3, align: 'right', lineBreak: false });
  }
  d.end();
  return done;
}
