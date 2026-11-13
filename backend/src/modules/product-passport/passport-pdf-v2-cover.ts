import { docName } from './passport-pdf';
import { firmAccent } from './passport-look-metrics';
import { PdfV2Input } from './passport-pdf-v2-types';
import { A5, M, CW, BOTTOM, V2Page, has, num, shortTiles, ruleIcon } from './passport-pdf-v2-common';

export function shortPage(doc: PDFKit.PDFDocument, input: PdfV2Input, color: string, purpose: string, box?: { l: number; r: number; t: number; b: number } | null): (V2Page & { h: number }) | null {
  const tiles = shortTiles(input.passport);
  const icons = (input.style?.icons || []).filter(Boolean);
  if (!tiles.length && !purpose && !icons.length) return null;
  const L = box ? box.l : M.l;
  const T = box ? box.t : M.t;
  const Btm = box ? A5.h - box.b : BOTTOM;
  const Wd = box ? A5.w - box.l - box.r : CW;
  // Высота блока — тем же расчётом, что рисование ниже: по ней основной текст идёт сразу под «Коротко», а не с нового листа
  const hOf = (font: string, size: number, s: string, w: number, lineGap = 0) => { doc.font(font).fontSize(size); return doc.heightOfString(s, { width: w, lineGap }); };
  let h = hOf('gost', 13, 'Коротко об изделии', Wd) + 12;
  if (tiles.length) {
    h += Math.ceil(Math.min(tiles.length, 6) / 3) * 56 + 8;
    if (tiles.length > 6) h += hOf('gost-i', 8.5, tiles.slice(6).map((t) => `${t.label}: ${t.value}`).join('; '), Wd) + 8;
  }
  if (purpose) h += hOf('gost', 10, 'Для чего', Wd) + 2 + Math.max(24, hOf('gost-i', 9.5, purpose, Wd, 0.6)) + 10;
  if (icons.length) {
    h += hOf('gost', 10, 'Главные правила', Wd) + 4;
    for (const s of icons) h += Math.max(16, hOf('gost-i', 9.2, s, Wd - 24)) + 5;
  }
  return { kind: 'body', footer: true, h: Math.min(h, Btm - T), draws: [{ y: T, draw: (d, y0) => {
    let y = y0;
    d.font('gost').fontSize(13).fillColor('#000').text('Коротко об изделии', L, y, { width: Wd });
    y = d.y + 2;
    d.lineWidth(1.4).strokeColor(color).moveTo(L, y).lineTo(L + Wd, y).stroke();
    y += 10;
    if (tiles.length) {
      const cols = 3, gap = 6, tw = (Wd - gap * (cols - 1)) / cols, th = 50;
      tiles.slice(0, 6).forEach((t, i) => {
        const x = L + (i % cols) * (tw + gap), yy = y + Math.floor(i / cols) * (th + gap);
        d.save().lineWidth(0.5).strokeColor('#000').rect(x, yy, tw, th).stroke().restore();
        d.font('gost-i').fontSize(7.6).fillColor('#000').text(t.label, x + 8, yy + 7, { width: tw - 12 });
        d.font('gost').fontSize(12).fillColor('#000').text(t.value, x + 8, yy + 26, { width: tw - 12, lineBreak: false, ellipsis: true });
      });
      y += Math.ceil(Math.min(tiles.length, 6) / cols) * (th + gap) + 8;
      if (tiles.length > 6) { d.font('gost-i').fontSize(8.5).fillColor('#000').text(tiles.slice(6).map((t) => `${t.label}: ${t.value}`).join('; '), L, y, { width: Wd }); y = d.y + 8; }
    }
    if (purpose) {
      d.font('gost').fontSize(10).fillColor('#000').text('Для чего', L, y, { width: Wd });
      y = d.y + 2;
      d.font('gost-i').fontSize(9.5);
      const room = Btm - y - (icons.length ? 80 : 0);
      const full = d.heightOfString(purpose, { width: Wd, lineGap: 0.6 });
      d.text(purpose, L, y, { width: Wd, lineGap: 0.6, height: Math.max(24, Math.min(full, room)), ellipsis: true });
      y += Math.min(full, Math.max(24, room)) + 10;
    }
    if (icons.length) {
      d.font('gost').fontSize(10).fillColor('#000').text('Главные правила', L, y, { width: Wd });
      y = d.y + 4;
      const r = 8;
      for (const s of icons) {
        d.font('gost-i').fontSize(9.2);
        const h = Math.max(2 * r, d.heightOfString(s, { width: Wd - 2 * r - 8 })) + 5;
        if (y + h > Btm) break; // «Коротко» — строго одна страница
        ruleIcon(d, L, y, r, s, color);
        d.font('gost-i').fontSize(9.2).fillColor('#000').text(s, L + 2 * r + 8, y + Math.max(0, r - 5.5), { width: Wd - 2 * r - 8 });
        y += h;
      }
    }
  } }] };
}

export function cover(input: PdfV2Input): V2Page {
  const { passport: p, org, images, logo } = input;
  const accent = firmAccent(input.look, input.mono);
  const box = input.look?.coverBox;
  // Без своих полей числа совпадают с прежней обложкой (M / CW).
  const l = box ? box.l : M.l;
  const r = box ? box.r : M.r;
  const cw = box ? A5.w - box.l - box.r : CW;
  const blank = !!(input.look?.cover);
  return { kind: 'cover', draws: [{ y: 0, draw: (d) => {
    const band = 64;
    const onBand = '#000';
    // Черта шапки и низа — для белого листа. На бланке их рисует картинка.
    if (!blank) d.lineWidth(1).strokeColor(accent).moveTo(0, band).lineTo(A5.w, band).stroke();
    const logoY = box ? Math.max(14, box.t) : 14;
    if (logo) {
      try { d.image(logo, l, logoY, { fit: [120, band - 28], align: 'center', valign: 'center' }); } catch { /* без логотипа */ }
    } else if (org?.shortName || org?.name) {
      d.font('gost').fontSize(12).fillColor(onBand).text(org.shortName || org.name || '', l, logoY + 10, { width: cw / 2, lineBreak: false, ellipsis: true });
    }
    if (org?.trademark) d.font('gost').fontSize(13).fillColor(onBand).text(`«${org.trademark.replace(/[«»"]/g, '')}»`, A5.w / 2, logoY + 10, { width: A5.w / 2 - r, align: 'right', lineBreak: false });
    let yy = band + 14;
    if (box && box.t > yy) yy = box.t;
    if (docName(org)) { d.font('gost').fontSize(10.5).fillColor('#000').text(docName(org), l, yy, { width: cw }); yy = d.y + 1; }
    // ИНН и КПП на обложке не нужны (пользователь 2026-11-13) — только контакты
    const ol = [org?.phone ? `Тел.: ${org.phone}` : '', org?.email ? `E-mail: ${org.email}` : ''].filter(Boolean).join(' · ');
    if (ol) { d.font('gost-i').fontSize(8.5).fillColor('#000').text(ol, l, yy, { width: cw }); yy = d.y; }
    yy = box ? yy + 18 : Math.max(yy + 18, 140);
    d.font('gost-i').fontSize(18).fillColor('#000').text(`ПАСПОРТ № ${p.passportNumber ?? ''}`, l, yy, { width: cw, align: 'center' });
    const nameFs = coverNameFontSize(p.name ?? '', (t, fs) => { d.font('gost-i').fontSize(fs); return d.heightOfString(t, { width: cw - 20, align: 'center' }); });
    d.font('gost-i').fontSize(nameFs).text(p.name ?? '', l + 10, d.y + 8, { width: cw - 20, align: 'center' });
    yy = d.y + 6;
    if (p.productCode) { d.font('gost-i').fontSize(10).fillColor('#000').text(`Номер изделия: ${p.productCode}`, l, yy, { width: cw, align: 'center' }); yy = d.y + 6; }
    // знак возраста по центру; плашки категории («Благоустройство») на обложке нет (пользователь 2026-11-13)
    const age = has(p.ageFrom) ? `${num(p.ageFrom)}+` : '';
    if (age) {
      const x = (box ? l + (cw - 26) / 2 : (A5.w - 26) / 2);
      d.lineWidth(1.4).strokeColor(accent).circle(x + 13, yy + 10, 12).stroke(); d.font('gost').fontSize(9).fillColor('#000').text(age, x, yy + 5.5, { width: 26, align: 'center', lineBreak: false });
      yy += 30;
    }
    const ov = images.overview?.[0];
    const bottom = box ? A5.h - box.b : A5.h - 40;
    if (ov && bottom - yy > 60) { try { const h = Math.min(bottom - yy, A5.h / 2); d.image(ov.buf, l, yy + (bottom - yy - h) / 2, { fit: [cw, h], align: 'center', valign: 'center' }); } catch { /* битая картинка — без неё */ } }
    if (p.certificate?.hasEac) {
      d.lineWidth(1.2).strokeColor(accent).rect(A5.w - r - 34, A5.h - 36, 34, 22).stroke();
      d.font('gost').fontSize(12).fillColor('#000').text('EAC', A5.w - r - 34, A5.h - 30, { width: 34, align: 'center', lineBreak: false });
    }
    if (!blank) d.lineWidth(0.5).strokeColor(accent).moveTo(0, A5.h - 8).lineTo(A5.w, A5.h - 8).stroke();
  } }] };
}

// ─────────────────────────── лист для стенда A3 (Э6d) ───────────────────────────


/** Размер шрифта названия на обложке: 14 pt, длинное — уменьшаем до 8 pt, пока не влезет в 3 строки (не режем). */
export function coverNameFontSize(name: string, heightOf: (t: string, fs: number) => number, maxLines = 3): number {
  for (let fs = 14; fs > 8; fs -= 0.5) if (heightOf(name, fs) <= fs * 1.25 * maxLines) return fs;
  return 8;
}
