import { existsSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import type { PassportTemplateContent, TemplateTable } from './passport-template.default';

/**
 * PDF паспорта (TASKS ПС.6) — макет по образцу №549 (docs/PASSPORTS-AUDIT.md §7): буклет A5 — титул, страницы 1…N,
 * гарантийный талон; число страниц дополняется до кратного 4. Режимы: «pages» — по странице A5; «print» — 2 страницы
 * на лист A4 альбомный, спуск для двусторонней печати буклетом (как в образце: [талон|титул], [1|N], [N-1|2]…).
 * Сборка без браузера (pdfkit), шрифт ГОСТ 2.304-81 тип А (backend/pwa/fonts, Apache-2.0).
 * Страницы сначала раскладываются (замер высоты текста), потом рисуются — так одна раскладка годится для обоих режимов.
 */

export interface PdfOrg {
  name?: string; shortName?: string; fullName?: string; inn?: string; kpp?: string; phone?: string; email?: string; trademark?: string;
  directorName?: string; signerName?: string; signerPosition?: string;
}
export interface PdfImage { buf: Buffer; caption?: string }
export interface PdfPassport {
  passportNumber?: string; warrantyCode?: string; productCode?: string; date?: Date | string | null; name?: string;
  description?: string; height?: number | null; length?: number | null; width?: number | null; weight?: number | null;
  warrantyMonths?: number; note?: string; bom?: Array<{ pos?: number; code?: string; name?: string; qty?: number; unit?: string; note?: string }>;
}
export interface PdfInput {
  passport: PdfPassport;
  org: PdfOrg | null;
  template: PassportTemplateContent;
  images: { overview?: PdfImage; dimensions: PdfImage[]; safety: PdfImage[]; mounting: PdfImage[] };
  seal?: Buffer; signature?: Buffer;
  withStamp: boolean;
  mode: 'pages' | 'print';
}

const A5 = { w: 419.53, h: 595.28 };
const A4L = { w: 841.89, h: 595.28 };
const M = { l: 34, r: 28, t: 30, b: 40 };
const CW = A5.w - M.l - M.r; // ширина набора
const BOTTOM = A5.h - M.b;
const BODY = 8.8; // кегль текста разделов (как в образце — мелкий наклонный)

export function fontDir(): string {
  const c = [join(process.cwd(), 'pwa', 'fonts'), join(__dirname, '..', '..', '..', 'pwa', 'fonts'), join(__dirname, '..', '..', '..', '..', 'pwa', 'fonts')];
  return c.find((p) => existsSync(join(p, 'gost-a.ttf'))) ?? c[0];
}

/** Название организации в документе: полное наименование, иначе обычное. */
export const docName = (o: PdfOrg | null | undefined) => String(o?.fullName || o?.name || '').trim();

/** «Тен Александр Тимурович» → «Тен А. Т.»; уже короткое — как есть. */
export function shortFio(full?: string): string {
  const p = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (p.length < 2 || /\./.test(p[1])) return p.join(' ');
  return `${p[0]} ${p.slice(1, 3).map((x) => `${x[0]}.`).join(' ')}`;
}

const num = (v: unknown) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? '—' : String(v).replace('.', ','));
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
/** Дата продажи в талоне: ««___» октября 2026 г.» — месяц прописью по дате паспорта, число — от руки при продаже. */
export function saleDateLine(d: PdfPassport['date']): string {
  const dt = d ? new Date(d) : new Date();
  return `«____» ${MONTHS_GEN[dt.getUTCMonth()]} ${dt.getUTCFullYear()} г.`;
}

export interface Page { kind: 'cover' | 'body' | 'warranty'; draws: Array<{ y: number; draw: (doc: PDFKit.PDFDocument, y: number) => void }>; no?: number }

export async function renderPassportPdf(input: PdfInput): Promise<Buffer> {
  const dir = fontDir();
  const doc = new PDFDocument({ autoFirstPage: false, size: input.mode === 'print' ? [A4L.w, A4L.h] : [A5.w, A5.h], margin: 0, info: { Title: `Паспорт № ${input.passport.passportNumber ?? ''}`, Author: input.org?.name ?? '' } });
  doc.registerFont('gost', join(dir, 'gost-a.ttf'));
  doc.registerFont('gost-i', join(dir, 'gost-a-slanted.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok, fail) => { doc.on('end', () => ok(Buffer.concat(chunks))); doc.on('error', fail); });

  const pages = layout(doc, input);
  const drawPage = (p: Page, ox: number) => {
    doc.save();
    doc.translate(ox, 0);
    doc.rect(0, 0, A5.w, A5.h).clip();
    for (const d of p.draws) d.draw(doc, d.y);
    if (p.no) doc.font('gost-i').fontSize(11).fillColor('#000').text(String(p.no), 0, A5.h - 28, { width: A5.w, align: 'center', lineBreak: false });
    doc.restore();
  };
  if (input.mode === 'pages') {
    for (const p of pages) { doc.addPage({ size: [A5.w, A5.h], margin: 0 }); drawPage(p, 0); }
  } else {
    const P = pages.length;
    const half = A4L.w / 2;
    for (let s = 0; s < P / 4; s++) {
      for (const [l, r] of [[P - 1 - 2 * s, 2 * s], [2 * s + 1, P - 2 - 2 * s]]) {
        doc.addPage({ size: [A4L.w, A4L.h], margin: 0 });
        drawPage(pages[l], (half - A5.w) / 2);
        drawPage(pages[r], half + (half - A5.w) / 2);
      }
    }
  }
  doc.end();
  return done;
}

/** Порядок страниц буклета для печати (номера логических страниц на сторонах листов) — для тестов и подписи в отчёте. */
export function imposition(P: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let s = 0; s < P / 4; s++) out.push([P - 1 - 2 * s, 2 * s], [2 * s + 1, P - 2 - 2 * s]);
  return out;
}

/** Раскладка: титул, тело (разделы 1–7, таблицы, приложения), страницы-добивки, талон. */
function layout(doc: PDFKit.PDFDocument, input: PdfInput): Page[] {
  const { passport: p, template: t, images } = input;
  const body: Page[] = [];
  let cur: Page = { kind: 'body', draws: [] };
  let y = M.t;
  const newPage = () => { body.push(cur); cur = { kind: 'body', draws: [] }; y = M.t; };
  const place = (h: number, draw: (d: PDFKit.PDFDocument, y: number) => void, keep = 0) => {
    if (y + h + keep > BOTTOM && cur.draws.length) newPage();
    cur.draws.push({ y, draw }); y += h;
  };
  const textH = (font: string, size: number, s: string, w = CW) => { doc.font(font).fontSize(size); return doc.heightOfString(s, { width: w, lineGap: 0.6 }); };
  const heading = (s: string, size = 12.5, gap = 6) => {
    const h = textH('gost', size, s) + gap;
    place(h + 4, (d, yy) => d.font('gost').fontSize(size).fillColor('#000').text(s, M.l, yy + 4, { width: CW, align: 'center' }), 40);
  };
  const para = (s: string, size = BODY, font = 'gost-i', indent = 0) => {
    const h = textH(font, size, s, CW - indent) + 1.6;
    place(h, (d, yy) => d.font(font).fontSize(size).fillColor('#000').text(s, M.l + indent, yy, { width: CW - indent, lineGap: 0.6 }));
  };
  const table = (title: string, cols: string[], widths: number[], rows: string[][], headSize = 7.2, rowH = 15, cellSize = 8) => {
    const ws = widths.map((w) => (w / widths.reduce((a, b) => a + b, 0)) * CW);
    doc.font('gost-i').fontSize(headSize);
    const headH = Math.max(18, ...cols.map((c, i) => doc.heightOfString(c, { width: ws[i] - 4 }) + 6));
    const titleH = textH('gost', 9, title) + 4;
    const drawHead = (d: PDFKit.PDFDocument, yy: number) => {
      let x = M.l;
      d.lineWidth(0.4).strokeColor('#555');
      cols.forEach((c, i) => { d.rect(x, yy, ws[i], headH).stroke(); d.font('gost-i').fontSize(headSize).fillColor('#000').text(c, x + 2, yy + 3, { width: ws[i] - 4, align: 'center' }); x += ws[i]; });
    };
    place(titleH, (d, yy) => d.font('gost').fontSize(9).fillColor('#000').text(title, M.l, yy, { width: CW }), headH + rowH * 2);
    place(headH, drawHead);
    for (const r of rows) {
      doc.font('gost-i').fontSize(cellSize);
      const h = Math.max(rowH, ...r.map((c, i) => (c ? doc.heightOfString(c, { width: ws[i] - 6 }) + 6 : 0)));
      if (y + h > BOTTOM) { newPage(); place(headH, drawHead); }
      place(h, (d, yy) => {
        let x = M.l;
        d.lineWidth(0.4).strokeColor('#555');
        r.forEach((c, i) => {
          d.rect(x, yy, ws[i], h).stroke();
          if (c) { d.font('gost-i').fontSize(cellSize); const th = d.heightOfString(c, { width: ws[i] - 6 }); d.text(c, x + 3, yy + (h - th) / 2 + 1, { width: ws[i] - 6, align: /^[\d,.—-]+$/.test(c) ? 'center' : 'left' }); }
          x += ws[i];
        });
      });
    }
    y += 6;
  };
  const tableOf = (k: string): TemplateTable | undefined => t.tables.find((x) => x.key === k);
  const blankRows = (tb: TemplateTable) => Array.from({ length: tb.rows }, () => tb.columns.map(() => ''));
  const months = String(p.warrantyMonths ?? 12);

  // 1–2: описание и габариты
  heading('1 Описание');
  para('1.1 Наименование, предназначение, установка:', 9, 'gost');
  para(p.description || p.name || '', 10);
  y += 6;
  heading('2 Основные технические данные');
  table('Таблица 1 — Габаритные размеры изделия в собранном виде', ['Наименование', 'Данные'], [70, 30],
    [['Высота, мм', num(p.height)], ['Длина, мм', num(p.length)], ['Ширина, мм', num(p.width)], ['Вес, кг', num(p.weight)]], 11, 20, 11);
  // 3–7 из шаблона; таблицы — после своего раздела
  for (const s of t.sections) {
    heading(s.title);
    for (const par of s.paragraphs) para(par.replace(/\{warrantyMonths\}/g, months), BODY, 'gost-i', par.startsWith('—') ? 6 : 0);
    y += 4;
    if (s.key === 'storage') for (const k of ['storage', 'faults']) { const tb = tableOf(k); if (tb) table(tb.title, tb.columns, tb.widths, blankRows(tb)); }
    if (s.key === 'service') { const tb = tableOf('service'); if (tb) table(tb.title, tb.columns, tb.widths, blankRows(tb)); }
  }
  // Приложения (по наличию картинок; нумерация по порядку)
  let app = 0;
  const imageBlock = (img: PdfImage, maxH: number) => {
    const capH = img.caption ? 14 : 0;
    place(maxH + capH + 6, (d, yy) => {
      try { d.image(img.buf, M.l, yy, { fit: [CW, maxH], align: 'center', valign: 'center' }); } catch { d.font('gost-i').fontSize(9).text('[картинка не читается]', M.l, yy + maxH / 2, { width: CW, align: 'center' }); }
      if (img.caption) d.font('gost-i').fontSize(9).fillColor('#000').text(img.caption, M.l, yy + maxH + 3, { width: CW, align: 'center' });
    });
  };
  const appendix = (title: string, imgs: PdfImage[], perPage: number) => {
    if (!imgs.length) return;
    app++;
    for (let i = 0; i < imgs.length; i += perPage) {
      if (cur.draws.length) newPage();
      heading(`Приложение ${app}\n${title}`, 11.5, 2);
      const room = BOTTOM - y - 8;
      const slice = imgs.slice(i, i + perPage);
      for (const im of slice) imageBlock(im, room / slice.length - (im.caption ? 22 : 8));
    }
  };
  appendix('Габариты изделия', images.dimensions, Math.max(1, images.dimensions.length)); // все картинки габаритов — на одном листе
  appendix('Инструкция по монтажу / сборке / установке', [...images.safety, ...images.mounting], 1);
  // Комплектность — всегда (по умолчанию «Изделие в сборе»)
  app++;
  if (cur.draws.length) newPage();
  heading(`Приложение ${app}\nКомплектность изделия`, 11.5, 2);
  if (images.overview) imageBlock({ buf: images.overview.buf }, 190);
  const bom = (p.bom?.length ? p.bom : [{ pos: 1, code: 'И-1', name: 'Изделие в сборе', qty: 1, unit: 'шт.' }]).map((b) => [String(b.pos ?? ''), b.code ?? '', b.name ?? '', b.qty === undefined ? '' : String(b.qty), b.unit ?? '', b.note ?? '']);
  while (bom.length < 10) bom.push(['', '', '', '', '', '']);
  table('Таблица 5 — Комплектность изделия', ['Поз.', 'Обозначение', 'Наименование', 'Кол-во', 'Ед. изм.', 'Примечание'], [8, 18, 34, 11, 11, 18], bom, 8);
  // «Для заметок» — только если есть заметка (пользователь 2026-10-22)
  const note = String(p.note ?? '').trim();
  if (note) {
    if (cur.draws.length) newPage();
    heading('Для заметок');
    para(note, 10);
  }
  body.push(cur);
  body.forEach((pg, i) => { pg.no = i + 1; });
  // печать буклетом: страниц кратно 4 — добивка пустыми сторонами (без номера), постранично — без добивки
  if (input.mode === 'print') while ((body.length + 2) % 4) body.push({ kind: 'body', draws: [] });
  return [cover(input), ...body, warranty(input)];
}

function orgLines(o: PdfOrg | null): string[] {
  if (!o) return [];
  return [
    o.inn ? `ИНН ${o.inn}${o.kpp ? `; КПП ${o.kpp}` : ''}` : '',
    o.phone ? `Телефон (факс): ${o.phone}` : '',
    o.email ? `E-mail: ${o.email}` : '',
    o.trademark ? `Торговая марка «${o.trademark.replace(/[«»"]/g, '')}»` : '',
  ].filter(Boolean);
}

function cover(input: PdfInput): Page {
  const { passport: p, org, images } = input;
  const draws: Page['draws'] = [{ y: 0, draw: (d) => {
    let yy = M.t;
    const x = A5.w / 2 - 40, w = A5.w - x - M.r;
    if (docName(org)) { d.font('gost').fontSize(12.5).fillColor('#000').text(docName(org), x, yy, { width: w }); yy = d.y + 1; }
    for (const l of orgLines(org)) { d.font('gost').fontSize(10).text(l, x, yy, { width: w }); yy = d.y; }
    yy = Math.max(yy + 26, 150);
    d.font('gost-i').fontSize(17).text(`ПАСПОРТ № ${p.passportNumber ?? ''}`, M.l, yy, { width: CW, align: 'center' });
    d.font('gost-i').fontSize(14).text(p.name ?? '', M.l + 10, d.y + 10, { width: CW - 20, align: 'center' });
    const top = d.y + 14;
    if (images.overview) { try { d.image(images.overview.buf, M.l, top, { fit: [CW, BOTTOM - top], align: 'center', valign: 'center' }); } catch { /* битая картинка — титул без неё */ } }
  } }];
  return { kind: 'cover', draws };
}

export function warranty(input: Pick<PdfInput, 'passport' | 'org' | 'withStamp' | 'seal' | 'signature'>): Page {
  const { passport: p, org, withStamp, seal, signature } = input;
  const seller = `${org?.signerPosition || 'Генеральный директор'} ${docName(org)} ${shortFio(org?.directorName || org?.signerName)}`.replace(/\s+/g, ' ').trim();
  const draws: Page['draws'] = [{ y: 0, draw: (d) => {
    const line = (label: string, yy: number, tail = '') => { d.font('gost-i').fontSize(11).fillColor('#000').text(`${label}`, M.l, yy, { continued: true }).text(`______________________________${tail}`); };
    d.font('gost').fontSize(14).fillColor('#000').text(`ГАРАНТИЙНЫЙ ТАЛОН № ${p.warrantyCode ?? ''}`, M.l, M.t, { width: CW, align: 'center' });
    d.font('gost-i').fontSize(12).text(p.name ?? '', M.l, d.y + 4, { width: CW, align: 'center' });
    d.font('gost-i').fontSize(13).text(`Номер изделия: ${p.productCode ?? ''}`, M.l, d.y + 14, { width: CW, align: 'center' });
    d.font('gost-i').fontSize(11).fillColor('#000').text(`Дата продажи: ${saleDateLine(p.date)}`, M.l, 230);
    line('Покупатель: ', 278);
    const sy = 330;
    d.font('gost-i').fontSize(11).text('Продавец: ______________', M.l, sy, { continued: false });
    d.font('gost-i').fontSize(10).text(seller, M.l + 128, sy + 1, { width: CW - 128 });
    d.font('gost-i').fontSize(11).text('М.П.', M.l + 120, sy + 34);
    if (withStamp && signature) { try { d.image(signature, M.l + 46, sy - 22, { fit: [80, 40] }); } catch { /* без подписи */ } }
    if (withStamp && seal) { try { d.image(seal, M.l + 84, sy - 16, { fit: [104, 104] }); } catch { /* без печати */ } }
    d.font('gost-i').fontSize(10.5).text('Покупатель с условиями гарантийного обслуживания ознакомлен, претензий по виду и комплектации не имеет.', M.l, 450, { width: CW });
    d.font('gost-i').fontSize(11).text('Подпись покупателя ____________________', M.l, 488);
    d.font('gost-i').fontSize(11).text('Страна происхождения: Россия', M.l, BOTTOM - 14, { width: CW, align: 'center' });
  } }];
  return { kind: 'warranty', draws };
}

