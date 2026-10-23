import { existsSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import type { PassportTemplateContent } from './passport-template.default';

/**
 * Общие части PDF паспорта (шрифт ГОСТ, спуск полос буклета, гарантийный талон, реквизиты) — их использует PDF паспорта
 * (passport-pdf-v2.ts). Прежний вид PDF без категории удалён (БЗ-7 шаг 1б, 2026-10-23: все паспорта — с категорией).
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
const M = { l: 34, r: 28, t: 30, b: 40 };
const CW = A5.w - M.l - M.r; // ширина набора
const BOTTOM = A5.h - M.b;

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

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
/** Дата продажи в талоне: ««___» октября 2026 г.» — месяц прописью по дате паспорта, число — от руки при продаже. */
export function saleDateLine(d: PdfPassport['date']): string {
  const dt = d ? new Date(d) : new Date();
  return `«____» ${MONTHS_GEN[dt.getUTCMonth()]} ${dt.getUTCFullYear()} г.`;
}

export interface Page { kind: 'cover' | 'body' | 'warranty'; draws: Array<{ y: number; draw: (doc: PDFKit.PDFDocument, y: number) => void }>; no?: number }

/** Порядок страниц буклета для печати (номера логических страниц на сторонах листов) — для тестов и подписи в отчёте. */
export function imposition(P: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let s = 0; s < P / 4; s++) out.push([P - 1 - 2 * s, 2 * s], [2 * s + 1, P - 2 - 2 * s]);
  return out;
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

