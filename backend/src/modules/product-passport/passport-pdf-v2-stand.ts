import PDFDocument from 'pdfkit';
import { join } from 'path';
import { fontDir, PdfOrg } from './passport-pdf';
import { PdfPassportV2, PdfV2Text, PdfV2Style, NEUTRAL_COLOR } from './passport-pdf-v2-types';
import { has, num, shortTiles, ruleIcon } from './passport-pdf-v2-common';

const A3 = { w: 841.89, h: 1190.55 };
export interface StandInput { passport: PdfPassportV2; org: PdfOrg | null; text: Pick<PdfV2Text, 'rules'> | null; style?: PdfV2Style; logo?: Buffer }

/** Правила для стенда: пиктограммы оформления + правила элементов, без повторов; «Не более N человек» — отдельной строкой. */
export function standRules(icons: string[] = [], rules: string[] = [], maxUsers?: number | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...icons, ...rules]) {
    const s = String(raw ?? '').trim().replace(/^[—–-]\s*/, '').replace(/[;.]$/, '');
    if (!s) continue;
    if (has(maxUsers) && /^не более \d+ человек/i.test(s)) continue;
    const k = s.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}

/**
 * Лист «Правила пользования» для информационного стенда (§3.7): одна страница A3 книжная — полоса категории, название,
 * плитки «Коротко», «Не более N человек», правила крупно с пиктограммами, поставщик и телефон внизу, № паспорта мелко.
 * Длинный список правил — шрифт уменьшается (до 13 пт), не влезает и так — лишние правила не печатаются (лист один).
 */
export async function renderStandPdf(input: StandInput): Promise<Buffer> {
  const dir = fontDir();
  const { passport: p, org, style } = input;
  const color = style?.color || NEUTRAL_COLOR;
  const doc = new PDFDocument({ autoFirstPage: false, size: [A3.w, A3.h], margin: 0, info: { Title: `Правила пользования — ${p.name ?? ''}`, Author: org?.name ?? '' } });
  doc.registerFont('gost', join(dir, 'gost-a.ttf'));
  doc.registerFont('gost-i', join(dir, 'gost-a-slanted.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok, fail) => { doc.on('end', () => ok(Buffer.concat(chunks))); doc.on('error', fail); });
  doc.addPage({ size: [A3.w, A3.h], margin: 0 });
  const d = doc;
  const L = 56, W = A3.w - 2 * L;

  // полоса категории (+ логотип справа)
  const band = 120;
  d.save().fillColor(color).rect(0, 0, A3.w, band).fill().restore();
  const cat = style?.categoryName || p.passportCategory || '';
  const logoW = input.logo ? 220 : 0;
  if (cat) d.font('gost').fontSize(30).fillColor('#fff').text(cat, L, band / 2 - 17, { width: W - logoW - 20, lineBreak: false, ellipsis: true });
  if (input.logo) {
    d.save().fillColor('#fff').roundedRect(A3.w - L - logoW, 20, logoW, band - 40, 6).fill().restore();
    try { d.image(input.logo, A3.w - L - logoW + 8, 24, { fit: [logoW - 16, band - 48], align: 'center', valign: 'center' }); } catch { /* без логотипа */ }
  }
  let y = band + 34;

  // название (уменьшаем, пока не влезет в 2–3 строки)
  const name = String(p.name ?? '').trim() || 'Изделие';
  let ns = 46;
  d.font('gost');
  while (ns > 24 && d.fontSize(ns).heightOfString(name, { width: W, align: 'center' }) > ns * 2.6) ns -= 2;
  d.font('gost').fontSize(ns).fillColor('#000').text(name, L, y, { width: W, align: 'center', height: ns * 3.6, ellipsis: true });
  y = d.y + 4;
  if (p.productCode) { d.font('gost-i').fontSize(18).fillColor('#444').text(`Артикул: ${p.productCode}`, L, y, { width: W, align: 'center' }); y = d.y; }
  y += 22;

  // «Коротко» — плитки (пользователей — отдельной строкой ниже)
  const tiles = shortTiles(p).filter((t) => t.label !== 'Пользователей одновременно').slice(0, 6);
  if (tiles.length) {
    const cols = 3, gap = 14, tw = (W - gap * (cols - 1)) / cols, th = 96;
    tiles.forEach((t, i) => {
      const x = L + (i % cols) * (tw + gap), yy = y + Math.floor(i / cols) * (th + gap);
      d.save().fillColor(color).fillOpacity(0.1).roundedRect(x, yy, tw, th, 10).fill().restore();
      d.save().fillColor(color).rect(x, yy + 12, 5, th - 24).fill().restore();
      d.font('gost-i').fontSize(16).fillColor('#444').text(t.label, x + 18, yy + 14, { width: tw - 28, lineBreak: false, ellipsis: true });
      d.font('gost').fontSize(30).fillColor('#000').text(t.value, x + 18, yy + 44, { width: tw - 28, lineBreak: false, ellipsis: true });
    });
    y += Math.ceil(tiles.length / cols) * (th + gap) + 8;
  }
  if (has(p.maxUsers)) {
    const h = 64;
    d.save().fillColor(color).roundedRect(L, y, W, h, 12).fill().restore();
    d.font('gost').fontSize(32).fillColor('#fff').text(`Не более ${num(p.maxUsers)} человек одновременно`, L, y + h / 2 - 19, { width: W, align: 'center', lineBreak: false, ellipsis: true });
    y += h + 26;
  }

  // низ: поставщик, телефон, № паспорта
  const footTop = A3.h - 120;
  const rules = standRules(style?.icons, input.text?.rules, p.maxUsers);
  if (rules.length) {
    d.font('gost').fontSize(30).fillColor('#000').text('Правила пользования', L, y, { width: W });
    y = d.y + 4;
    d.lineWidth(3).strokeColor(color).moveTo(L, y).lineTo(L + W, y).stroke();
    y += 18;
    const room = footTop - 20 - y;
    const sizeOf = (fs: number) => { const r = fs * 0.85, gap = fs * 0.7; d.font('gost-i').fontSize(fs); return rules.reduce((sum, s) => sum + Math.max(2 * r, d.heightOfString(s, { width: W - 2 * r - 20 })) + gap, 0); };
    let fs = 34;
    while (fs > 13 && sizeOf(fs) > room) fs -= 1;
    const r = fs * 0.85, gap = fs * 0.7;
    for (const s of rules) {
      d.font('gost-i').fontSize(fs);
      const h = Math.max(2 * r, d.heightOfString(s, { width: W - 2 * r - 20 }));
      if (y + h > footTop - 20) break; // лист строго один
      ruleIcon(d, L, y, r, s, color);
      d.font('gost-i').fontSize(fs).fillColor('#000').text(s, L + 2 * r + 20, y + Math.max(0, r - fs * 0.6), { width: W - 2 * r - 20 });
      y += h + gap;
    }
  }
  d.lineWidth(1.2).strokeColor(color).moveTo(L, footTop).lineTo(L + W, footTop).stroke();
  const who = org?.shortName || org?.name || '';
  const contact = [who, org?.phone ? `тел. ${org.phone}` : ''].filter(Boolean).join(' · ');
  if (contact) d.font('gost').fontSize(22).fillColor('#000').text(contact, L, footTop + 16, { width: W, align: 'center', lineBreak: false, ellipsis: true });
  if (org?.email) d.font('gost-i').fontSize(14).fillColor('#333').text(org.email, L, footTop + 48, { width: W, align: 'center', lineBreak: false });
  d.font('gost-i').fontSize(10).fillColor('#666').text(`Паспорт № ${p.passportNumber ?? ''}`, L, A3.h - 38, { width: W, align: 'right', lineBreak: false });
  d.save().fillColor(color).rect(0, A3.h - 14, A3.w, 14).fill().restore();
  doc.end();
  return done;
}

