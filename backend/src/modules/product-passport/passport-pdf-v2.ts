import { guardDoc } from '../../common/print/safe-doc';
import PDFDocument from 'pdfkit';
import { join } from 'path';
import { fontDir, imposition } from './passport-pdf';
import { firmAccent } from './passport-look-metrics';
import { PdfV2Input } from './passport-pdf-v2-types';
import { A5, A4L, M, CW, V2Page } from './passport-pdf-v2-common';
import { cover } from './passport-pdf-v2-cover';
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
  return renderPassportsPdfV2([input]);
}

/**
 * Несколько паспортов в одном PDF подряд (паспорта заказа, ПНЗ): тот же рендер, у каждого своя нумерация страниц и подвал.
 * `after` — дописать листы в тот же файл до закрытия (техописание A4 после паспорта, C055).
 */
export async function renderPassportsPdfV2(inputs: PdfV2Input[], title?: string, after?: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  const first = inputs[0];
  const dir = fontDir();
  const doc = guardDoc(new PDFDocument({ autoFirstPage: false, size: first.mode === 'print' ? [A4L.w, A4L.h] : [A5.w, A5.h], margin: 0, info: { Title: title ?? `Паспорт № ${first.passport.passportNumber ?? ''}`, Author: first.org?.name ?? '' } }), 'Паспорт');
  doc.registerFont('gost', join(dir, 'gost-a.ttf'));
  doc.registerFont('gost-i', join(dir, 'gost-a-slanted.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok, fail) => { doc.on('end', () => ok(Buffer.concat(chunks))); doc.on('error', fail); });
  const bgCache = new Map<Buffer, OpenedImage>();
  for (const input of inputs) drawOne(doc, input, bgCache);
  after?.(doc);
  doc.end();
  return done;
}

/** Открытая картинка pdfkit: у неё есть width/height, повторный image() не вкладывает байты заново. */
type OpenedImage = { width: number; height: number };
type DocImg = PDFKit.PDFDocument & {
  openImage(src: Buffer): OpenedImage;
  image(src: OpenedImage, x: number, y: number, opt: { width: number; height: number }): void;
};

/** Картинку бланка вкладываем один раз на документ и ставим ссылкой на каждой странице. */
function paintBg(doc: PDFKit.PDFDocument, buf: Buffer | null | undefined, cache: Map<Buffer, OpenedImage>) {
  if (!buf) return;
  const api = doc as DocImg;
  let image = cache.get(buf);
  if (!image) {
    try { image = api.openImage(buf); } catch { return; }
    cache.set(buf, image);
  }
  try { api.image(image, 0, 0, { width: A5.w, height: A5.h }); } catch { /* битый фон — белая страница */ }
}

/** Одна страница — обложка с бланком фирмы. В паспорт ничего не пишет. */
export async function renderPassportCoverPreview(input: PdfV2Input): Promise<Buffer> {
  const dir = fontDir();
  const doc = guardDoc(new PDFDocument({ autoFirstPage: false, size: [A5.w, A5.h], margin: 0, info: { Title: 'Образец обложки паспорта', Author: input.org?.name ?? '' } }), 'Паспорт');
  doc.registerFont('gost', join(dir, 'gost-a.ttf'));
  doc.registerFont('gost-i', join(dir, 'gost-a-slanted.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok, fail) => { doc.on('end', () => ok(Buffer.concat(chunks))); doc.on('error', fail); });
  const page = cover(input);
  doc.addPage({ size: [A5.w, A5.h], margin: 0 });
  paintBg(doc, input.look?.cover, new Map());
  for (const d of page.draws) d.draw(doc, d.y);
  doc.end();
  return done;
}

function drawOne(doc: PDFKit.PDFDocument, input: PdfV2Input, bgCache: Map<Buffer, OpenedImage>) {
  const color = firmAccent(input.look, input.mono);
  const pages = layoutV2(doc, input, color);
  const total = pages.reduce((m, p) => Math.max(m, p.no ?? 0), 0);
  const foot = `${input.org?.shortName || input.org?.name || ''}${input.org?.shortName || input.org?.name ? ' · ' : ''}${input.passport.passportNumber ? `Паспорт № ${input.passport.passportNumber}` : 'Паспорт — черновик, без номера'}`;
  const drawPage = (p: V2Page, ox: number) => {
    doc.save();
    doc.translate(ox, 0);
    doc.rect(0, 0, A5.w, A5.h).clip();
    paintBg(doc, p.kind === 'cover' ? input.look?.cover : input.look?.page, bgCache);
    for (const d of p.draws) d.draw(doc, d.y);
    if (input.watermark) {
      doc.save().opacity(0.16).rotate(-35, { origin: [A5.w / 2, A5.h / 2] });
      doc.font('gost').fontSize(42).fillColor('#000').text(input.watermark, 0, A5.h / 2 - 22, { width: A5.w, align: 'center', lineBreak: false });
      doc.restore();
    }
    if (p.no && p.footer) {
      const pb = input.look?.pageBox;
      const fl = pb ? pb.l : M.l;
      const fr = pb ? pb.r : M.r;
      const fw = pb ? A5.w - pb.l - pb.r : CW;
      const fy = pb ? A5.h - pb.b + 14 : A5.h - 30;
      doc.lineWidth(0.6).strokeColor(color).moveTo(fl, fy).lineTo(A5.w - fr, fy).stroke();
      doc.font('gost-i').fontSize(8).fillColor('#000').text(foot, fl, fy + 5, { width: fw - 60, lineBreak: false, ellipsis: true });
      doc.font('gost-i').fontSize(8).fillColor('#000').text(`стр. ${p.no}/${total}`, A5.w - fr - 60, fy + 5, { width: 60, align: 'right', lineBreak: false });
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
}
