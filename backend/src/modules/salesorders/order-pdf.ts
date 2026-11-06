import { existsSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { guardDoc } from '../../common/print/safe-doc';
import { fontDir } from '../product-passport/passport-pdf';

/**
 * Печать заказа производства целиком (пользователь 2026-11-06: «красивый вид, одной кнопкой весь заказ с перечнем, А4»).
 * Шапка: логотип и реквизиты нашей компании; заголовок «Заказ № …», этап, заказчик, сроки;
 * по каждому договору — плашка и таблица позиций; итоги по договору и заказу; внизу страницы — «стр. X из Y».
 * Деньги (цена, сумма, оплачено) — только если money. Отменённые договоры и позиции не печатаются.
 */
export interface OrderPdfLine { seqNo?: number | null; title: string; note?: string; sku?: string; qty?: number; unit?: string; price?: number; amount?: number; shipDate?: Date | string | null }
export interface OrderPdfContract { orderNo: string; contractDate?: Date | string | null; customer?: string; title?: string; stageLabel?: string; lines: OrderPdfLine[]; paid?: number }
export interface OrderPdfInput {
  number: string;
  stageLabel?: string;
  customer?: string;
  productionDeadline?: Date | string | null;
  shipDate?: Date | string | null;
  org: { name: string; inn?: string; address?: string; phone?: string };
  logo?: Buffer;
  contracts: OrderPdfContract[];
  money: boolean;
  printedAt?: Date;
}

const W = 595.28, H = 841.89, ML = 36, MR = 36, MT = 36, MB = 46;
const CW = W - ML - MR;
/** Обычный шрифт документа (как у КП): DejaVu Sans на сервере; на ПК — Segoe UI; нет — ГОСТ. */
const pick = (list: string[], fallback: string) => list.find((p) => existsSync(p)) ?? fallback;
export const orderFonts = (dir: string) => ({
  regular: pick(['/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/freefont/FreeSans.ttf', 'C:/Windows/Fonts/segoeui.ttf'], join(dir, 'gost-a.ttf')),
  bold: pick(['/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf', 'C:/Windows/Fonts/segoeuib.ttf'], join(dir, 'gost-a.ttf')),
});
const INK = '#111111', MUTED = '#5a5a5a', RULE = '#b8b8b8', BAND = '#ececec', HEAD = '#f5f5f5';

export const ruDate = (v?: Date | string | null) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
};
export const ruNum = (n?: number) => (n === undefined || n === null || !Number.isFinite(n) ? '' : String(Math.round(n * 1000) / 1000).replace('.', ','));
export const ruMoney = (n?: number) => (n === undefined || n === null || !Number.isFinite(n) ? '' : (Math.round(n * 100) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, ' '));

/** Колонки: [заголовок, ширина (0 — остаток под наименование), выравнивание]. */
export function orderColumns(money: boolean): Array<[string, number, 'left' | 'right' | 'center']> {
  return [['№', 26, 'center'], ['Наименование', 0, 'left'], ['Артикул', 62, 'left'], ['Кол-во', 44, 'right'], ['Ед.', 30, 'center'],
    ...(money ? [['Цена', 62, 'right'], ['Сумма', 70, 'right']] as Array<[string, number, 'right']> : []), ['Отгрузка', 56, 'center']];
}

export function renderOrderPdf(i: OrderPdfInput): Promise<Buffer> {
  const dir = fontDir();
  const d = guardDoc(new PDFDocument({ size: [W, H], margin: 0, bufferPages: true, info: { Title: `Заказ № ${i.number}`, Author: i.org.name || 'Рабочее место' } }), 'Заказ');
  const ff = orderFonts(dir);
  d.registerFont('gost', ff.regular);
  d.registerFont('bold', ff.bold);
  const chunks: Buffer[] = [];
  d.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok, fail) => { d.on('end', () => ok(Buffer.concat(chunks))); d.on('error', fail); });

  const cols = orderColumns(i.money);
  const fixed = cols.reduce((a, c) => a + c[1], 0);
  const widths = cols.map((c) => c[1] || CW - fixed);
  const xs = widths.reduce<number[]>((a, w, k) => [...a, k ? a[k - 1] + widths[k - 1] : ML], []);
  const font = (size: number, color = INK) => d.font('gost').fontSize(size).fillColor(color);
  const bold = (size: number, color = INK) => d.font('bold').fontSize(size).fillColor(color);
  const rule = (y: number, color = RULE, w = 0.5) => d.lineWidth(w).strokeColor(color).moveTo(ML, y).lineTo(W - MR, y).stroke();
  let y = MT;

  // ---------- шапка: логотип + реквизиты ----------
  let textX = ML;
  if (i.logo) {
    try { d.image(i.logo, ML, y, { fit: [96, 44], valign: 'center' }); textX = ML + 108; } catch { /* без логотипа */ }
  }
  bold(12.5).text(i.org.name || 'Наша компания', textX, y + 2, { width: W - MR - textX, lineBreak: false, ellipsis: true });
  const orgLine = [i.org.inn ? `ИНН ${i.org.inn}` : '', i.org.address ?? '', i.org.phone ? `тел. ${i.org.phone}` : ''].filter(Boolean).join(' · ');
  if (orgLine) font(8.5, MUTED).text(orgLine, textX, y + 20, { width: W - MR - textX, height: 24, ellipsis: true });
  y += 52;
  rule(y, INK, 1);
  y += 14;

  // ---------- заголовок заказа ----------
  bold(19).text(`Заказ № ${i.number}`, ML, y, { width: CW * 0.65, lineBreak: false });
  if (i.stageLabel) font(10.5, MUTED).text(i.stageLabel, ML + CW * 0.65, y + 7, { width: CW * 0.35, align: 'right', lineBreak: false });
  y += 30;
  const facts = [i.customer ? `Заказчик: ${i.customer}` : '', i.productionDeadline ? `Срок изготовления: ${ruDate(i.productionDeadline)}` : '', i.shipDate ? `Отгрузка: ${ruDate(i.shipDate)}` : ''].filter(Boolean);
  if (facts.length) { font(10, INK).text(facts.join('   ·   '), ML, y, { width: CW }); y = d.y + 10; }

  // ---------- таблица ----------
  const headRow = () => {
    d.rect(ML, y, CW, 18).fill(HEAD);
    cols.forEach(([t, , al], k) => bold(7.5, MUTED).text(t, xs[k] + 4, y + 5, { width: widths[k] - 8, align: al, lineBreak: false }));
    rule(y + 18);
    y += 18;
  };
  const room = (h: number) => { if (y + h > H - MB) { d.addPage(); y = MT; return true; } return false; };
  let grandLines = 0, grandSum = 0, grandPaid = 0;

  for (const c of i.contracts) {
    // плашка договора не отрывается от первой строки таблицы
    room(26 + 18 + 30);
    d.rect(ML, y, CW, 24).fill(BAND);
    const head = [`Договор № ${c.orderNo || '—'}${c.contractDate ? ` от ${ruDate(c.contractDate)}` : ''}`, c.customer, c.title].filter(Boolean).join('  ·  ');
    bold(9.5).text(head, ML + 8, y + 7.5, { width: CW - 16 - (c.stageLabel ? 110 : 0), lineBreak: false, ellipsis: true });
    if (c.stageLabel) font(8.5, MUTED).text(c.stageLabel, W - MR - 118, y + 8, { width: 110, align: 'right', lineBreak: false });
    y += 26;
    headRow();
    let sum = 0;
    for (const l of c.lines) {
      const tw = widths[1] - 8;
      const th = font(9.5).heightOfString(l.title || '—', { width: tw });
      const nh = l.note ? font(7.5).heightOfString(l.note, { width: tw }) : 0;
      const rh = Math.max(20, Math.min(th, 42) + (nh ? Math.min(nh, 20) + 2 : 0) + 9);
      if (room(rh)) headRow();
      const cells: string[] = [l.seqNo != null ? String(l.seqNo) : '', '', l.sku ?? '', ruNum(l.qty), l.unit ?? '',
        ...(i.money ? [ruMoney(l.price), ruMoney(l.amount)] : []), ruDate(l.shipDate)];
      cells.forEach((t, k) => { if (k !== 1) font(9).text(t, xs[k] + 4, y + 6, { width: widths[k] - 8, align: cols[k][2], lineBreak: false, ellipsis: true }); });
      font(9.5).text(l.title || '—', xs[1] + 4, y + 5, { width: tw, height: 42, ellipsis: true });
      if (l.note) font(7.5, MUTED).text(l.note, xs[1] + 4, y + 5 + Math.min(th, 42) + 1, { width: tw, height: 20, ellipsis: true });
      y += rh;
      rule(y);
      sum += Number(l.amount) || 0;
    }
    if (!c.lines.length) { room(20); font(9, MUTED).text('Позиций нет', ML + 8, y + 6, { lineBreak: false }); y += 20; rule(y); }
    room(22);
    const tot = `Итого по договору: позиций ${c.lines.length}` + (i.money ? `   ·   сумма ${ruMoney(sum)} ₽` + (c.paid ? `   ·   оплачено ${ruMoney(c.paid)} ₽` : '') : '');
    font(9.5).text(tot, ML, y + 6, { width: CW, align: 'right', lineBreak: false });
    y += 30;
    grandLines += c.lines.length; grandSum += sum; grandPaid += Number(c.paid) || 0;
  }

  // ---------- итог заказа ----------
  room(56);
  rule(y, INK, 1);
  y += 8;
  bold(11.5).text(`Всего по заказу: договоров ${i.contracts.length}, позиций ${grandLines}`, ML, y, { width: CW * 0.55, lineBreak: false });
  if (i.money) {
    bold(11.5).text(`${ruMoney(grandSum)} ₽`, ML + CW * 0.55, y, { width: CW * 0.45, align: 'right', lineBreak: false });
    if (grandPaid) font(9.5, MUTED).text(`оплачено ${ruMoney(grandPaid)} ₽ · к оплате ${ruMoney(Math.max(0, grandSum - grandPaid))} ₽`, ML + CW * 0.35, y + 18, { width: CW * 0.65, align: 'right', lineBreak: false });
  }

  // ---------- подвал: страницы ----------
  const at = i.printedAt ?? new Date();
  const stamp = `${ruDate(at)} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const range = d.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    d.switchToPage(p);
    d.lineWidth(0.5).strokeColor(RULE).moveTo(ML, H - 30).lineTo(W - MR, H - 30).stroke();
    font(7.5, MUTED).text(`Заказ № ${i.number} · сформировано ${stamp}`, ML, H - 24, { width: CW / 2, lineBreak: false });
    font(7.5, MUTED).text(`стр. ${p - range.start + 1} из ${range.count}`, ML + CW / 2, H - 24, { width: CW / 2, align: 'right', lineBreak: false });
  }
  d.end();
  return done;
}
