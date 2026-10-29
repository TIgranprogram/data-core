import { docName } from './passport-pdf';
import { PdfV2Input } from './passport-pdf-v2-types';
import { A5, M, CW, BOTTOM, V2Page, has, num, shortTiles, ruleIcon } from './passport-pdf-v2-common';

export function shortPage(doc: PDFKit.PDFDocument, input: PdfV2Input, color: string, purpose: string): V2Page | null {
  const tiles = shortTiles(input.passport);
  const icons = (input.style?.icons || []).filter(Boolean);
  if (!tiles.length && !purpose && !icons.length) return null;
  return { kind: 'body', footer: true, draws: [{ y: M.t, draw: (d, y0) => {
    let y = y0;
    d.font('gost').fontSize(13).fillColor('#000').text('Коротко об изделии', M.l, y, { width: CW });
    y = d.y + 2;
    d.lineWidth(1.4).strokeColor(color).moveTo(M.l, y).lineTo(M.l + CW, y).stroke();
    y += 10;
    if (tiles.length) {
      const cols = 3, gap = 6, tw = (CW - gap * (cols - 1)) / cols, th = 50;
      tiles.slice(0, 6).forEach((t, i) => {
        const x = M.l + (i % cols) * (tw + gap), yy = y + Math.floor(i / cols) * (th + gap);
        d.save().lineWidth(0.5).strokeColor('#000').rect(x, yy, tw, th).stroke().restore();
        d.font('gost-i').fontSize(7.6).fillColor('#000').text(t.label, x + 8, yy + 7, { width: tw - 12 });
        d.font('gost').fontSize(12).fillColor('#000').text(t.value, x + 8, yy + 26, { width: tw - 12, lineBreak: false, ellipsis: true });
      });
      y += Math.ceil(Math.min(tiles.length, 6) / cols) * (th + gap) + 8;
      if (tiles.length > 6) { d.font('gost-i').fontSize(8.5).fillColor('#000').text(tiles.slice(6).map((t) => `${t.label}: ${t.value}`).join('; '), M.l, y, { width: CW }); y = d.y + 8; }
    }
    if (purpose) {
      d.font('gost').fontSize(10).fillColor('#000').text('Для чего', M.l, y, { width: CW });
      y = d.y + 2;
      d.font('gost-i').fontSize(9.5);
      const room = BOTTOM - y - (icons.length ? 80 : 0);
      const full = d.heightOfString(purpose, { width: CW, lineGap: 0.6 });
      d.text(purpose, M.l, y, { width: CW, lineGap: 0.6, height: Math.max(24, Math.min(full, room)), ellipsis: true });
      y += Math.min(full, Math.max(24, room)) + 10;
    }
    if (icons.length) {
      d.font('gost').fontSize(10).fillColor('#000').text('Главные правила', M.l, y, { width: CW });
      y = d.y + 4;
      const r = 8;
      for (const s of icons) {
        d.font('gost-i').fontSize(9.2);
        const h = Math.max(2 * r, d.heightOfString(s, { width: CW - 2 * r - 8 })) + 5;
        if (y + h > BOTTOM) break; // «Коротко» — строго одна страница
        ruleIcon(d, M.l, y, r, s, color);
        d.font('gost-i').fontSize(9.2).fillColor('#000').text(s, M.l + 2 * r + 8, y + Math.max(0, r - 5.5), { width: CW - 2 * r - 8 });
        y += h;
      }
    }
  } }] };
}

export function cover(input: PdfV2Input): V2Page {
  const { passport: p, org, images, logo, style } = input;
  return { kind: 'cover', draws: [{ y: 0, draw: (d) => {
    const band = 64;
    // ч/б — шапка без заливки: черта снизу, надписи чёрные
    const onBand = '#000';
    d.lineWidth(1).strokeColor('#000').moveTo(0, band).lineTo(A5.w, band).stroke();
    if (logo) {
      try { d.image(logo, M.l, 14, { fit: [120, band - 28], align: 'center', valign: 'center' }); } catch { /* без логотипа */ }
    } else if (org?.shortName || org?.name) {
      d.font('gost').fontSize(12).fillColor(onBand).text(org.shortName || org.name || '', M.l, 24, { width: CW / 2, lineBreak: false, ellipsis: true });
    }
    if (org?.trademark) d.font('gost').fontSize(13).fillColor(onBand).text(`«${org.trademark.replace(/[«»"]/g, '')}»`, A5.w / 2, 24, { width: A5.w / 2 - M.r, align: 'right', lineBreak: false });
    let yy = band + 14;
    if (docName(org)) { d.font('gost').fontSize(10.5).fillColor('#000').text(docName(org), M.l, yy, { width: CW }); yy = d.y + 1; }
    const ol = [org?.inn ? `ИНН ${org.inn}${org.kpp ? `; КПП ${org.kpp}` : ''}` : '', org?.phone ? `Тел.: ${org.phone}` : '', org?.email ? `E-mail: ${org.email}` : ''].filter(Boolean).join(' · ');
    if (ol) { d.font('gost-i').fontSize(8.5).fillColor('#000').text(ol, M.l, yy, { width: CW }); yy = d.y; }
    yy = Math.max(yy + 18, 140);
    d.font('gost-i').fontSize(18).fillColor('#000').text(`ПАСПОРТ № ${p.passportNumber ?? ''}`, M.l, yy, { width: CW, align: 'center' });
    const nameFs = coverNameFontSize(p.name ?? '', (t, fs) => { d.font('gost-i').fontSize(fs); return d.heightOfString(t, { width: CW - 20, align: 'center' }); });
    d.font('gost-i').fontSize(nameFs).text(p.name ?? '', M.l + 10, d.y + 8, { width: CW - 20, align: 'center' });
    yy = d.y + 6;
    if (p.productCode) { d.font('gost-i').fontSize(10).fillColor('#000').text(`Артикул: ${p.productCode}`, M.l, yy, { width: CW, align: 'center' }); yy = d.y + 6; }
    // плашка категории + возраст «N+» кружком
    const cat = style?.categoryName || p.passportCategory || '';
    const age = has(p.ageFrom) ? `${num(p.ageFrom)}+` : '';
    if (cat || age) {
      d.font('gost').fontSize(10);
      const cw = cat ? d.widthOfString(cat) + 20 : 0, aw = age ? 26 : 0, gap = cat && age ? 8 : 0;
      let x = (A5.w - cw - aw - gap) / 2;
      if (cat) { d.save().lineWidth(0.8).strokeColor('#000').roundedRect(x, yy, cw, 20, 10).stroke().restore(); d.font('gost').fontSize(10).fillColor('#000').text(cat, x, yy + 5, { width: cw, align: 'center', lineBreak: false }); x += cw + gap; }
      if (age) { d.lineWidth(1.4).strokeColor('#000').circle(x + 13, yy + 10, 12).stroke(); d.font('gost').fontSize(9).fillColor('#000').text(age, x, yy + 5.5, { width: 26, align: 'center', lineBreak: false }); }
      yy += 30;
    }
    const ov = images.overview?.[0];
    const bottom = A5.h - 40;
    if (ov && bottom - yy > 60) { try { const h = Math.min(bottom - yy, A5.h / 2); d.image(ov.buf, M.l, yy + (bottom - yy - h) / 2, { fit: [CW, h], align: 'center', valign: 'center' }); } catch { /* битая картинка — без неё */ } }
    if (p.certificate?.hasEac) {
      d.lineWidth(1.2).strokeColor('#000').rect(A5.w - M.r - 34, A5.h - 36, 34, 22).stroke();
      d.font('gost').fontSize(12).fillColor('#000').text('EAC', A5.w - M.r - 34, A5.h - 30, { width: 34, align: 'center', lineBreak: false });
    }
    d.lineWidth(0.5).strokeColor('#000').moveTo(0, A5.h - 8).lineTo(A5.w, A5.h - 8).stroke();
  } }] };
}

// ─────────────────────────── лист для стенда A3 (Э6d) ───────────────────────────


/** Размер шрифта названия на обложке: 14 pt, длинное — уменьшаем до 8 pt, пока не влезет в 3 строки (не режем). */
export function coverNameFontSize(name: string, heightOf: (t: string, fs: number) => number, maxLines = 3): number {
  for (let fs = 14; fs > 8; fs -= 0.5) if (heightOf(name, fs) <= fs * 1.25 * maxLines) return fs;
  return 8;
}
