import PDFDocument from 'pdfkit';
import { join } from 'path';
import { fontDir, imposition } from './passport-pdf';
import { PdfV2Input, NEUTRAL_COLOR, MONO_COLOR } from './passport-pdf-v2-types';
import { A5, A4L, M, CW, V2Page } from './passport-pdf-v2-common';
import { layoutV2 } from './passport-pdf-v2-layout';

/**
 * PDF паспорта v2 (БЗ-6 Э6a, Э6b; docs/PASSPORTS-V2.md §3.6, §3.7) — единственный вид PDF (с 2026-10-23, БЗ-7 шаг 1б); для паспорта
 * со снимком текста (`textSnapshot.sections`). Размер и режимы: буклет A5 постранично или A4 «в печать» тем же спуском.
 * Порядок: обложка → «Коротко» → [описание, правила — если номера 1…N-1 свободны] → разделы снимка → [описание, правила]
 * → ТО по периодам (чек-лист) → монтаж → комплектность → приложения с рисунками → [для заметок] → талон (как в v1).
 * Ссылки {fig:вид} → «рис. N», {tab:ключ} → «табл. N» (сквозная нумерация); нет рисунка/таблицы — ссылка выпадает.
 * Рисунок со ссылкой в абзаце — сразу после этого абзаца (не помещается — первым на следующей странице), в приложения
 * не дублируется; остальные — в приложения в порядке первой ссылки, без ссылки — в конце в порядке видов (Э6d).
 * В таблицах ТО — колонка «Вид» с миниатюрой дефекта, если картинка есть хотя бы у одной строки (Э6d).
 * Отдельно — лист для информационного стенда A3 (`renderStandPdf`, Э6d).
 */

export * from './passport-pdf-v2-types';
export * from './passport-pdf-v2-refs';
export * from './passport-pdf-v2-stand';
export { shortTiles } from './passport-pdf-v2-common';

export async function renderPassportPdfV2(input: PdfV2Input): Promise<Buffer> {
  const dir = fontDir();
  const doc = new PDFDocument({ autoFirstPage: false, size: input.mode === 'print' ? [A4L.w, A4L.h] : [A5.w, A5.h], margin: 0, info: { Title: `Паспорт № ${input.passport.passportNumber ?? ''}`, Author: input.org?.name ?? '' } });
  doc.registerFont('gost', join(dir, 'gost-a.ttf'));
  doc.registerFont('gost-i', join(dir, 'gost-a-slanted.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok, fail) => { doc.on('end', () => ok(Buffer.concat(chunks))); doc.on('error', fail); });

  const color = input.mono ? MONO_COLOR : input.style?.color || NEUTRAL_COLOR;
  const pages = layoutV2(doc, input, color);
  const total = pages.reduce((m, p) => Math.max(m, p.no ?? 0), 0);
  const foot = `${input.org?.shortName || input.org?.name || ''}${input.org?.shortName || input.org?.name ? ' · ' : ''}${input.passport.passportNumber ? `Паспорт № ${input.passport.passportNumber}` : 'Паспорт — черновик, без номера'}`;
  const drawPage = (p: V2Page, ox: number) => {
    doc.save();
    doc.translate(ox, 0);
    doc.rect(0, 0, A5.w, A5.h).clip();
    for (const d of p.draws) d.draw(doc, d.y);
    if (input.watermark) {
      doc.save().rotate(-35, { origin: [A5.w / 2, A5.h / 2] }).font('gost').fontSize(64).fillColor('#9a9a9a').fillOpacity(0.28)
        .text(input.watermark, 0, A5.h / 2 - 34, { width: A5.w, align: 'center', lineBreak: false }).restore();
    }
    if (p.no && p.footer) {
      const fy = A5.h - 30;
      doc.lineWidth(0.6).strokeColor(color).moveTo(M.l, fy).lineTo(A5.w - M.r, fy).stroke();
      doc.font('gost-i').fontSize(8).fillColor('#444').text(foot, M.l, fy + 5, { width: CW - 60, lineBreak: false, ellipsis: true });
      doc.font('gost-i').fontSize(8).fillColor('#444').text(`стр. ${p.no}/${total}`, A5.w - M.r - 60, fy + 5, { width: 60, align: 'right', lineBreak: false });
    }
    doc.restore();
  };
  if (input.mode === 'pages') {
    for (const p of pages) { doc.addPage({ size: [A5.w, A5.h], margin: 0 }); drawPage(p, 0); }
  } else {
    const half = A4L.w / 2;
    for (const [l, r] of imposition(pages.length)) {
      doc.addPage({ size: [A4L.w, A4L.h], margin: 0 });
      drawPage(pages[l], (half - A5.w) / 2);
      drawPage(pages[r], half + (half - A5.w) / 2);
    }
  }
  doc.end();
  return done;
}

