import { join } from 'path';
import PDFDocument from 'pdfkit';
import { fontDir, imposition, warranty, type Page, type PdfImage, type PdfOrg, type PdfPassport, docName } from './passport-pdf';
import type { ComposedSection } from './passport-compose';
import type { InstallParts, MaintenanceTable } from './passport-compose-parts';

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

export interface PdfImageV2 extends PdfImage { refCode?: string }
export interface PdfPassportV2 extends PdfPassport {
  passportCategory?: string;
  ageFrom?: number | null; ageTo?: number | null; heightMin?: number | null; heightMax?: number | null;
  weightMax?: number | null; maxUsers?: number | null; fallHeight?: number | null; serviceLifeYears?: number | null;
  certificate?: { number?: string; until?: string; hasEac?: boolean } | null;
}
/** Снимок текста (V2Text) — терпимо к неполным старым снимкам. */
export interface PdfV2Text {
  sections: ComposedSection[];
  description?: string; purpose?: string; rules?: string[];
  maintenance?: MaintenanceTable[]; install?: Partial<InstallParts>;
}
export interface PdfV2Style { color?: string; categoryName?: string; icons?: string[] }
export interface PdfV2Input {
  passport: PdfPassportV2;
  org: PdfOrg | null;
  text: PdfV2Text;
  images: Partial<Record<string, PdfImageV2[]>>;
  style?: PdfV2Style;
  logo?: Buffer; seal?: Buffer; signature?: Buffer;
  /** Миниатюры дефектов для таблиц ТО: photoId → картинка (Э6d). */
  defectImages?: Record<string, Buffer>;
  withStamp: boolean;
  mode: 'pages' | 'print';
  /** Чёрно-белый: без цвета категории и заливки шапки обложки — для печати на ч/б принтере (решение пользователя 2026-10-22). */
  mono?: boolean;
}

export const NEUTRAL_COLOR = '#546E7A';
export const MONO_COLOR = '#000';

type StyleRow = { kind?: unknown; category?: unknown; color?: unknown; use?: unknown; text?: unknown; code?: unknown };
/** Оформление из справочника `passportStyle`: цвет категории (иначе нейтральный) и тексты пиктограмм правил ({maxUsers} подставлен). */
export function resolveStyle(rows: StyleRow[], category: string | undefined, vars: { maxUsers?: number | null } = {}): { color: string; icons: string[] } {
  const on = (r: StyleRow) => String(r.use ?? '').trim().toLowerCase() !== 'нет';
  const cat = String(category || '').trim();
  const hex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : '');
  const colorRow = cat ? rows.find((r) => r.kind === 'цвет категории' && String(r.category) === cat && on(r) && hex(r.color)) : undefined;
  const icons: string[] = [];
  for (const r of rows) {
    if (r.kind !== 'пиктограмма правил' || !on(r)) continue;
    const c = String(r.category ?? '').trim();
    if (c && c !== 'ALL' && c !== cat) continue;
    let t = String(r.text ?? '').trim();
    if (!t) continue;
    if (t.includes('{maxUsers}')) { if (!vars.maxUsers) continue; t = t.replace(/\{maxUsers\}/g, String(vars.maxUsers)); }
    icons.push(t);
  }
  return { color: hex(colorRow?.color) || NEUTRAL_COLOR, icons };
}

const REF = /\{(fig|tab):([^}]+)\}/g;
const fmtNums = (n: number[]) => (n.length === 1 ? String(n[0]) : n.every((x, i) => i === 0 || x === n[i - 1] + 1) ? `${n[0]}–${n[n.length - 1]}` : n.join(', '));

/** {fig:вид} → «рис. N» (несколько рисунков вида — «рис. 3–5»), {tab:ключ} → «табл. N»; нет номера — ссылка выпадает вместе со «(см. …)». */
export function substituteRefs(s: string, fig: Map<string, number[]>, tab: Map<string, number>): string {
  if (!s || !s.includes('{')) return s;
  const known = (t: string, k: string) => (t === 'fig' ? !!fig.get(k)?.length : tab.has(k));
  let out = s.replace(REF, (m, t: string, k: string) => {
    if (!known(t, k)) return m;
    return t === 'fig' ? `рис. ${fmtNums(fig.get(k) as number[])}` : `табл. ${tab.get(k)}`;
  });
  out = out
    .replace(/\s*\((?:см\.\s*)?\{(?:fig|tab):[^}]+\}\)/g, '')
    .replace(/(?:,\s*)?(?:см\.\s*)?\{(?:fig|tab):[^}]+\}/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
  return out;
}

/** Приложения с рисунками (§3.6): виды → приложение. overview — на обложке, bom_item — в таблице комплектности. */
export const APPENDIX_GROUPS: Array<{ key: string; title: string; kinds: string[]; perPage: number }> = [
  { key: 'callouts', title: 'Общий вид и элементы изделия', kinds: ['overview_callouts', 'nameplate'], perPage: 1 },
  { key: 'dimensions', title: 'Габариты и зона безопасности', kinds: ['dimensions', 'safety_zone'], perPage: 2 },
  { key: 'foundation', title: 'Схемы установки опор', kinds: ['foundation'], perPage: 1 },
  { key: 'holes', title: 'Схема скважин и разметки', kinds: ['holes'], perPage: 1 },
  { key: 'mounting', title: 'Инструкция по монтажу', kinds: ['safety', 'mounting'], perPage: 1 },
  { key: 'assembly', title: 'Инструкция по сборке', kinds: ['assembly'], perPage: 2 },
];
const KIND_TITLE: Record<string, string> = {
  overview_callouts: 'Общий вид изделия с обозначением элементов', nameplate: 'Место маркировочной таблички',
  dimensions: 'Габаритные размеры', safety_zone: 'Зона безопасности', foundation: 'Схема установки опор',
  holes: 'Схема разметки скважин', safety: 'Требования безопасности при монтаже', mounting: 'Монтаж изделия', assembly: 'Сборка',
};

export type PlannedFig = { no: number; kind: string; img: PdfImageV2; caption: string };
export interface FigurePlan {
  appendices: Array<{ title: string; perPage: number; figs: PlannedFig[] }>;
  /** Рисунки «по месту» (Э6d): вид → рисунки, которые ставятся сразу после абзаца с первой ссылкой {fig:вид}. */
  inline: Map<string, PlannedFig[]>;
  fig: Map<string, number[]>;
}

/**
 * Нумерация рисунков (§3.6). Вид со ссылкой в абзацах (`paraTexts` — в порядке документа) — «по месту»: номера первыми,
 * в порядке первой ссылки; в приложения такие рисунки не попадают. Остальные — приложения в порядке первой ссылки
 * в `texts` (например, из таблиц ТО), без ссылки — в конце в порядке видов.
 */
export function planFigures(texts: string[], images: Partial<Record<string, PdfImageV2[]>>, paraTexts: string[] = []): FigurePlan {
  const all = texts.join('\n');
  const paras = paraTexts.join('\n');
  const firstRef = (kind: string) => { const i = all.indexOf(`{fig:${kind}}`); return i < 0 ? Number.POSITIVE_INFINITY : i; };
  const paraRef = (kind: string) => paras.indexOf(`{fig:${kind}}`);
  const fig = new Map<string, number[]>();
  let n = 0;
  const mk = (k: string, img: PdfImageV2, i: number): PlannedFig => {
    n += 1;
    fig.set(k, [...(fig.get(k) || []), n]);
    const base = KIND_TITLE[k] || k;
    return { no: n, kind: k, img, caption: `Рисунок ${n} — ${img.caption?.trim() || (k === 'assembly' ? `${base}, шаг ${i + 1}` : base)}` };
  };
  const inline = new Map<string, PlannedFig[]>();
  const inlineKinds = APPENDIX_GROUPS.flatMap((g) => g.kinds).filter((k) => images[k]?.length && paraRef(k) >= 0).sort((a, b) => paraRef(a) - paraRef(b));
  for (const k of inlineKinds) inline.set(k, (images[k] || []).map((img, i) => mk(k, img, i)));

  const groups = APPENDIX_GROUPS
    .map((g, gi) => ({ g, gi, kinds: g.kinds.filter((k) => images[k]?.length && !inline.has(k)) }))
    .map((x) => ({ ...x, rank: Math.min(Number.POSITIVE_INFINITY, ...x.kinds.map(firstRef)) }))
    .filter((x) => x.kinds.length)
    .sort((a, b) => (a.rank - b.rank) || (a.gi - b.gi));
  const appendices: FigurePlan['appendices'] = [];
  for (const { g, kinds } of groups) {
    const ordered = kinds.map((k, ki) => ({ k, ki, r: firstRef(k) })).sort((a, b) => (a.r - b.r) || (a.ki - b.ki));
    const figs: PlannedFig[] = [];
    for (const { k } of ordered) (images[k] || []).forEach((img, i) => figs.push(mk(k, img, i)));
    appendices.push({ title: g.title, perPage: g.perPage, figs });
  }
  return { appendices, inline, fig };
}

/** Колонки таблицы ТО (§3.7): «Вид» с миниатюрой дефекта — только если картинка есть хотя бы у одной строки. */
export function maintenanceColumns(rows: Array<{ photoId?: string }>, defectImages: Record<string, Buffer> = {}): { cols: string[]; widths: number[]; withImg: boolean } {
  const withImg = rows.some((r) => !!r.photoId && !!defectImages[r.photoId]);
  return withImg
    ? { cols: ['Отм.', 'Что проверить', 'Вид', 'Где', 'Как проверить', 'Норма'], widths: [7, 27, 15, 17, 17, 17], withImg }
    : { cols: ['Отм.', 'Что проверить', 'Где', 'Как проверить', 'Норма'], widths: [7, 33, 20, 20, 20], withImg };
}

// ─────────────────────────── вёрстка ───────────────────────────

const A5 = { w: 419.53, h: 595.28 };
const A4L = { w: 841.89, h: 595.28 };
const M = { l: 34, r: 28, t: 30, b: 44 };
const CW = A5.w - M.l - M.r;
const BOTTOM = A5.h - M.b;
const BODY = 8.8;

type Draw = (d: PDFKit.PDFDocument, y: number) => void;
type Cell = string | { box: true } | { img?: Buffer; h: number };

const has = (v: unknown) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));
const num = (v: unknown) => String(v).replace('.', ',');
function years(n: number): string {
  const a = Math.abs(n) % 100, b = a % 10;
  return `${num(n)} ${a > 10 && a < 20 ? 'лет' : b === 1 ? 'год' : b >= 2 && b <= 4 ? 'года' : 'лет'}`;
}
const range = (a: unknown, b: unknown, unit: string) => (has(a) && has(b) ? `${num(a)}–${num(b)} ${unit}` : has(a) ? `от ${num(a)} ${unit}` : has(b) ? `до ${num(b)} ${unit}` : '');
const lines = (s?: string) => String(s ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

/** Плитки «Коротко» (§3.7): только заполненные. */
export function shortTiles(p: PdfPassportV2): Array<{ label: string; value: string }> {
  return [
    { label: 'Возраст', value: range(p.ageFrom, p.ageTo, 'лет') },
    { label: 'Рост пользователя', value: range(p.heightMin, p.heightMax, 'см') },
    { label: 'Пользователей одновременно', value: has(p.maxUsers) ? `не более ${num(p.maxUsers)}` : '' },
    { label: 'Вес пользователя', value: has(p.weightMax) ? `до ${num(p.weightMax)} кг` : '' },
    { label: 'Высота падения', value: has(p.fallHeight) ? `до ${num(p.fallHeight)} мм` : '' },
    { label: 'Срок службы', value: has(p.serviceLifeYears) ? years(Number(p.serviceLifeYears)) : '' },
    { label: 'Гарантия', value: has(p.warrantyMonths) ? `${num(p.warrantyMonths)} мес.` : '' },
  ].filter((t) => t.value);
}

/** Пиктограмма правила: «Не …» — запрещающий знак (красный круг с чертой), иначе — информационный (круг цвета категории). */
function ruleIcon(d: PDFKit.PDFDocument, x: number, y: number, r: number, text: string, color: string) {
  const cx = x + r, cy = y + r;
  if (/^не\s/i.test(text)) {
    d.save().lineWidth(1.6).strokeColor(color === MONO_COLOR ? MONO_COLOR : '#C62828').circle(cx, cy, r - 1).stroke();
    d.moveTo(cx - (r - 1) * 0.7, cy - (r - 1) * 0.7).lineTo(cx + (r - 1) * 0.7, cy + (r - 1) * 0.7).stroke().restore();
  } else {
    d.save().fillColor(color).circle(cx, cy, r).fill();
    d.font('gost').fontSize(r * 1.3).fillColor('#fff').text('!', x, cy - r * 0.62, { width: 2 * r, align: 'center', lineBreak: false }).restore();
  }
}

interface V2Page extends Page { footer?: boolean }

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
  const foot = `${input.org?.shortName || input.org?.name || ''}${input.org?.shortName || input.org?.name ? ' · ' : ''}Паспорт № ${input.passport.passportNumber ?? ''}`;
  const drawPage = (p: V2Page, ox: number) => {
    doc.save();
    doc.translate(ox, 0);
    doc.rect(0, 0, A5.w, A5.h).clip();
    for (const d of p.draws) d.draw(doc, d.y);
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

function layoutV2(doc: PDFKit.PDFDocument, input: PdfV2Input, color: string): V2Page[] {
  const { passport: p, text: t, images } = input;
  const sections = (t.sections || []).filter((s) => s.items?.length || s.title);
  const maintenance = (t.maintenance || []).filter((m) => m.rows?.length);
  const installLines = lines(t.install?.text);
  const requirements = (t.install?.requirements || []).map((x) => String(x).trim()).filter(Boolean);
  const rules = (t.rules || []).map((x) => String(x).trim()).filter(Boolean);
  const descr = lines(t.description || p.description);
  const purpose = lines(t.purpose);
  const specs: string[][] = [['Высота, мм', p.height], ['Длина, мм', p.length], ['Ширина, мм', p.width], ['Вес, кг', p.weight]]
    .filter(([, v]) => has(v)).map(([k, v]) => [String(k), num(v)]);

  // Номера разделов: снимок даёт свои (обычно с 3 — 1 и 2 были «Описание» и «Техданные» v1). Свободные 1…start-1 — под описание/правила.
  const start = parseInt(sections[0]?.number ?? '', 10) || 1;
  const lastNo = sections.reduce((m, s) => Math.max(m, parseInt(s.number, 10) || 0), 0);
  const descrBlock = descr.length || purpose.length || specs.length;
  const rulesBlock = rules.length > 0;
  const before = start > 1;
  const mergeRules = before && start === 2; // один свободный номер — правила внутри описания
  let next = before ? 1 : lastNo + 1;
  const descrNo = descrBlock || (mergeRules && rulesBlock) ? String(next++) : '';
  const rulesNo = rulesBlock && !mergeRules ? String(next++) : '';
  if (before) next = lastNo + 1;
  const toNo = maintenance.length ? String(next++) : '';
  const installNo = installLines.length || requirements.length ? String(next++) : '';
  const bomNo = String(next++);

  // Таблицы — сквозная нумерация в порядке документа
  const tab = new Map<string, number>();
  let tn = 0;
  if (specs.length) tab.set('specs', ++tn);
  maintenance.forEach((m, i) => { const n = ++tn; tab.set(`to:${m.period}`, n); if (i === 0) { tab.set('to', n); tab.set('maintenance', n); } });
  tab.set('bom', ++tn);

  // Рисунки — по первой ссылке в тексте (тексты в порядке документа)
  const secTexts = sections.flatMap((s) => [s.title, ...s.items.map((i) => i.text)]);
  const descrTexts = [...descr, ...purpose, ...rules];
  const flowTexts = [...(before ? descrTexts : []), ...secTexts, ...(before ? [] : descrTexts),
    ...maintenance.flatMap((m) => m.rows.flatMap((r) => [r.what, r.where, r.measure, r.tolerance])), ...installLines, ...requirements];
  // Абзацы, после которых может встать рисунок «по месту» (в порядке вывода)
  const paraTexts = [...(before ? descrTexts : []), ...sections.flatMap((s) => s.items.map((i) => i.text)), ...(before ? [] : descrTexts), ...installLines, ...requirements];
  const figs = planFigures(flowTexts, images, paraTexts);
  const R = (s: string) => substituteRefs(s, figs.fig, tab);

  const body: V2Page[] = [];
  let cur: V2Page = { kind: 'body', draws: [], footer: true };
  let y = M.t;
  // Рисунки «по месту» (§3.6): не помещается после абзаца — ждёт в очереди и встаёт первым на следующей странице
  // (текст продолжает заполнять текущую); порядок рисунков сохраняется.
  const pending: PlannedFig[] = [];
  const placedKinds = new Set<string>();
  const breakPage = () => { body.push(cur); cur = { kind: 'body', draws: [], footer: true }; y = M.t; };
  const figSize = (f: PlannedFig) => {
    let ar = 0.62;
    try { const im = (doc as unknown as { openImage(b: Buffer): { width: number; height: number } }).openImage(f.img.buf); if (im.width > 0 && im.height > 0) ar = im.height / im.width; } catch { /* битая — пропорция по умолчанию */ }
    const capH = textH('gost-i', 9, f.caption) + 4;
    const h = Math.max(60, Math.min(CW * ar, BOTTOM - M.t - capH - 14));
    return { h, capH, total: h + capH + 10 };
  };
  const putFig = (f: PlannedFig) => {
    const { h, total } = figSize(f);
    if (y + total > BOTTOM && cur.draws.length) breakPage();
    cur.draws.push({ y, draw: (d, yy) => {
      try { d.image(f.img.buf, M.l, yy + 2, { fit: [CW, h], align: 'center', valign: 'center' }); } catch { d.font('gost-i').fontSize(9).fillColor('#000').text('[картинка не читается]', M.l, yy + h / 2, { width: CW, align: 'center' }); }
      d.font('gost-i').fontSize(9).fillColor('#000').text(f.caption, M.l, yy + h + 5, { width: CW, align: 'center' });
    } });
    y += total;
  };
  const flush = () => { while (pending.length) putFig(pending.shift() as PlannedFig); };
  const newPage = () => { breakPage(); flush(); };
  /** После абзаца: рисунки видов, на которые здесь первая ссылка. */
  const figsAfter = (raw: string) => {
    if (!raw || !raw.includes('{fig:')) return;
    const kinds = [...raw.matchAll(/\{fig:([^}]+)\}/g)].map((m) => m[1]).filter((k, i, a) => a.indexOf(k) === i);
    for (const k of kinds) {
      if (placedKinds.has(k) || !figs.inline.has(k)) continue;
      placedKinds.add(k);
      for (const f of figs.inline.get(k) || []) {
        if (!pending.length && y + figSize(f).total <= BOTTOM) putFig(f);
        else pending.push(f);
      }
    }
  };
  const place = (h: number, draw: Draw, keep = 0) => {
    if (y + h + keep > BOTTOM && cur.draws.length) newPage();
    cur.draws.push({ y, draw }); y += h;
  };
  const textH = (font: string, size: number, s: string, w = CW) => { doc.font(font).fontSize(size); return doc.heightOfString(s, { width: w, lineGap: 0.6 }); };
  const heading = (s: string, size = 12, keep = 40) => {
    const h = textH('gost', size, s) + 10;
    place(h + 4, (d, yy) => {
      d.font('gost').fontSize(size).fillColor('#000').text(s, M.l, yy + 4, { width: CW, lineGap: 0.6 });
      const ly = yy + 4 + d.heightOfString(s, { width: CW, lineGap: 0.6 }) + 2;
      d.lineWidth(1.4).strokeColor(color).moveTo(M.l, ly).lineTo(M.l + CW, ly).stroke();
    }, keep);
  };
  const sub = (s: string) => { const h = textH('gost', 9.5, s) + 3; place(h, (d, yy) => d.font('gost').fontSize(9.5).fillColor('#000').text(s, M.l, yy, { width: CW, lineGap: 0.6 }), 20); };
  const para = (s: string, size = BODY, font = 'gost-i', indent = 0) => {
    if (!s) return;
    const h = textH(font, size, s, CW - indent) + 1.6;
    place(h, (d, yy) => d.font(font).fontSize(size).fillColor('#000').text(s, M.l + indent, yy, { width: CW - indent, lineGap: 0.6 }));
  };
  const table = (title: string, cols: string[], widths: number[], rows: Cell[][], cellSize = 8) => {
    const ws = widths.map((w) => (w / widths.reduce((a, b) => a + b, 0)) * CW);
    doc.font('gost-i').fontSize(7.2);
    const headH = Math.max(18, ...cols.map((c, i) => doc.heightOfString(c, { width: ws[i] - 4 }) + 6));
    const titleH = textH('gost', 9, title) + 4;
    const drawHead = (d: PDFKit.PDFDocument, yy: number) => {
      let x = M.l;
      d.save().fillColor(color).fillOpacity(0.12).rect(M.l, yy, CW, headH).fill().restore();
      d.lineWidth(0.4).strokeColor('#555');
      cols.forEach((c, i) => { d.rect(x, yy, ws[i], headH).stroke(); d.font('gost-i').fontSize(7.2).fillColor('#000').text(c, x + 2, yy + 3, { width: ws[i] - 4, align: 'center' }); x += ws[i]; });
    };
    place(titleH, (d, yy) => d.font('gost').fontSize(9).fillColor('#000').text(title, M.l, yy, { width: CW }), headH + 30);
    place(headH, drawHead);
    for (const r of rows) {
      doc.font('gost-i').fontSize(cellSize);
      const h = Math.max(15, ...r.map((c, i) => (typeof c === 'string' ? (c ? doc.heightOfString(c, { width: ws[i] - 6 }) + 6 : 0) : 'h' in c ? c.h + 4 : 0)));
      if (y + h > BOTTOM) { newPage(); place(headH, drawHead); }
      place(h, (d, yy) => {
        let x = M.l;
        d.lineWidth(0.4).strokeColor('#555');
        r.forEach((c, i) => {
          d.rect(x, yy, ws[i], h).stroke();
          if (typeof c === 'string') {
            if (c) { d.font('gost-i').fontSize(cellSize).fillColor('#000'); const th = d.heightOfString(c, { width: ws[i] - 6 }); d.text(c, x + 3, yy + (h - th) / 2 + 1, { width: ws[i] - 6, align: /^[\d,.—-]+$/.test(c) ? 'center' : 'left' }); }
          } else if ('box' in c) {
            const s = 7.5; d.lineWidth(0.8).strokeColor('#000').rect(x + (ws[i] - s) / 2, yy + (h - s) / 2, s, s).stroke(); d.lineWidth(0.4).strokeColor('#555');
          } else if (c.img) {
            try { d.image(c.img, x + 2, yy + 2, { fit: [ws[i] - 4, h - 4], align: 'center', valign: 'center' }); } catch { /* битая миниатюра — пустая ячейка */ }
          }
          x += ws[i];
        });
      });
    }
    y += 6;
  };
  const item = (txt: string, numStr: string | null, bullet: boolean) => {
    const s = R(txt);
    if (!s) return;
    if (bullet) para(/^[—–-]\s/.test(s) ? s : `— ${s}`, BODY, 'gost-i', 6);
    else para(numStr ? `${numStr} ${s}` : s);
    figsAfter(txt);
  };
  const paraR = (raw: string, prefix = '') => { para(`${prefix}${R(raw)}`); figsAfter(raw); };

  // «Коротко» — одна страница
  const short = shortPage(doc, input, color, R(lines(t.purpose).join(' ') || descr[0] || ''));
  if (short) body.push(short);

  const descrSection = () => {
    if (!descrNo) return;
    let k = 0;
    heading(`${descrNo} Описание и назначение`);
    if (descr.length) { sub(`${descrNo}.${++k} Описание изделия`); descr.forEach((s) => paraR(s)); y += 3; }
    if (purpose.length) { sub(`${descrNo}.${++k} Назначение`); purpose.forEach((s) => paraR(s)); y += 3; }
    if (specs.length) { sub(`${descrNo}.${++k} Основные технические данные`); table(`Таблица ${tab.get('specs')} — Габаритные размеры и масса изделия`, ['Наименование', 'Значение'], [70, 30], specs, 9); }
    if (mergeRules && rules.length) { sub(`${descrNo}.${++k} Правила пользования`); rules.forEach((s) => item(s, null, true)); }
    y += 4;
  };
  const rulesSection = () => {
    if (!rulesNo) return;
    heading(`${rulesNo} Правила пользования`);
    rules.forEach((s) => item(s, null, true));
    y += 4;
  };

  if (before) { descrSection(); rulesSection(); }
  for (const s of sections) {
    if (!s.items?.length) continue;
    heading(`${s.number} ${R(s.title)}`.trim());
    for (const it of s.items) item(it.text, it.number, it.bullet);
    y += 4;
  }
  if (!before) { descrSection(); rulesSection(); }

  if (toNo) {
    heading(`${toNo} Техническое обслуживание (чек-лист)`);
    para('Отмечайте выполненные проверки в графе «Отм.». Неисправность — изделие закрыть для пользования до устранения.');
    y += 3;
    const dimg = input.defectImages || {};
    for (const m of maintenance) {
      const mc = maintenanceColumns(m.rows, dimg);
      table(`Таблица ${tab.get(`to:${m.period}`)} — Осмотр и обслуживание: ${m.period}`, mc.cols, mc.widths,
        m.rows.map((r) => {
          const pic = r.photoId ? dimg[r.photoId] : undefined;
          const row: Cell[] = [{ box: true }, R(r.what || '')];
          if (mc.withImg) row.push({ img: pic, h: pic ? 34 : 11 });
          row.push(R(r.where || ''), R(r.measure || ''), R(r.tolerance || ''));
          return row;
        }), 7.6);
    }
  }
  if (installNo) {
    heading(`${installNo} Монтаж`);
    installLines.forEach((s, i) => paraR(s, `${installNo}.${i + 1} `));
    if (requirements.length) { y += 2; sub('Требования к основанию:'); requirements.forEach((s) => item(s, null, true)); }
    y += 4;
  }
  // Комплектность — всегда (по умолчанию «Изделие в сборе»); миниатюры bom_item — по refCode
  heading(`${bomNo} Комплектность`);
  const thumbs = new Map<string, Buffer>();
  for (const im of images.bom_item || []) if (im.refCode && !thumbs.has(im.refCode)) thumbs.set(im.refCode, im.buf);
  const bom = p.bom?.length ? p.bom : [{ pos: 1, code: 'И-1', name: 'Изделие в сборе', qty: 1, unit: 'шт.' }];
  const withImg = bom.some((b) => b.code && thumbs.has(b.code));
  const bomRows: Cell[][] = bom.map((b, i) => {
    const row: Cell[] = [String(b.pos ?? i + 1), b.code ?? '', b.name ?? '', b.qty === undefined ? '' : String(b.qty), b.unit ?? ''];
    if (withImg) row.push({ img: b.code ? thumbs.get(b.code) : undefined, h: b.code && thumbs.has(b.code) ? 40 : 11 });
    return row;
  });
  table(`Таблица ${tab.get('bom')} — Комплектность изделия`, ['Поз.', 'Обозначение', 'Наименование', 'Кол-во', 'Ед. изм.', ...(withImg ? ['Изображение'] : [])],
    withImg ? [7, 17, 36, 9, 9, 22] : [8, 20, 50, 11, 11], bomRows);

  // Рисунки «по месту», которые не встали (ссылка только в непоказанном абзаце), и очередь — до приложений
  for (const [k, list] of figs.inline) if (!placedKinds.has(k)) { placedKinds.add(k); pending.push(...list); }
  if (pending.length) newPage();
  // Приложения с рисунками
  const figBlock = (f: PlannedFig, maxH: number) => {
    const capH = textH('gost-i', 9, f.caption) + 4;
    place(maxH + capH + 6, (d, yy) => {
      try { d.image(f.img.buf, M.l, yy, { fit: [CW, maxH], align: 'center', valign: 'center' }); } catch { d.font('gost-i').fontSize(9).fillColor('#000').text('[картинка не читается]', M.l, yy + maxH / 2, { width: CW, align: 'center' }); }
      d.font('gost-i').fontSize(9).fillColor('#000').text(f.caption, M.l, yy + maxH + 3, { width: CW, align: 'center' });
    });
  };
  figs.appendices.forEach((a, ai) => {
    for (let i = 0; i < a.figs.length; i += a.perPage) {
      if (cur.draws.length) newPage();
      heading(`Приложение ${ai + 1}${i ? ' (продолжение)' : ''}\n${a.title}`, 11, 0);
      const slice = a.figs.slice(i, i + a.perPage);
      const room = BOTTOM - y - 4;
      for (const f of slice) figBlock(f, Math.max(60, room / slice.length - textH('gost-i', 9, f.caption) - 12));
    }
  });
  // «Для заметок» — только если есть заметка (как v1)
  const note = String(p.note ?? '').trim();
  if (note) { if (cur.draws.length) newPage(); heading('Для заметок'); para(note, 10); }
  if (cur.draws.length) body.push(cur);
  body.forEach((pg, i) => { pg.no = i + 1; });
  if (input.mode === 'print') while ((body.length + 2) % 4) body.push({ kind: 'body', draws: [] });
  return [cover(input, color), ...body, warranty({ ...input, passport: p })];
}

/** «Коротко» (§3.7): плитки, «для чего», ключевые правила-пиктограммы. Пусто — страницы нет. */
function shortPage(doc: PDFKit.PDFDocument, input: PdfV2Input, color: string, purpose: string): V2Page | null {
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
        d.save().fillColor(color).fillOpacity(0.1).roundedRect(x, yy, tw, th, 5).fill().restore();
        d.save().fillColor(color).rect(x, yy + 6, 2.5, th - 12).fill().restore();
        d.font('gost-i').fontSize(7.6).fillColor('#444').text(t.label, x + 8, yy + 7, { width: tw - 12 });
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

function cover(input: PdfV2Input, color: string): V2Page {
  const { passport: p, org, images, logo, style } = input;
  return { kind: 'cover', draws: [{ y: 0, draw: (d) => {
    const band = 64;
    // ч/б — шапка без заливки: черта снизу, надписи чёрные
    const onBand = color === MONO_COLOR ? MONO_COLOR : '#fff';
    if (color === MONO_COLOR) d.lineWidth(1.4).strokeColor(color).moveTo(0, band).lineTo(A5.w, band).stroke();
    else d.save().fillColor(color).rect(0, 0, A5.w, band).fill().restore();
    if (logo) {
      d.save().fillColor('#fff').roundedRect(M.l - 4, 12, 128, band - 24, 4).fill().restore();
      try { d.image(logo, M.l, 14, { fit: [120, band - 28], align: 'center', valign: 'center' }); } catch { /* без логотипа */ }
    } else if (org?.shortName || org?.name) {
      d.font('gost').fontSize(12).fillColor(onBand).text(org.shortName || org.name || '', M.l, 24, { width: CW / 2, lineBreak: false, ellipsis: true });
    }
    if (org?.trademark) d.font('gost').fontSize(13).fillColor(onBand).text(`«${org.trademark.replace(/[«»"]/g, '')}»`, A5.w / 2, 24, { width: A5.w / 2 - M.r, align: 'right', lineBreak: false });
    let yy = band + 14;
    if (docName(org)) { d.font('gost').fontSize(10.5).fillColor('#000').text(docName(org), M.l, yy, { width: CW }); yy = d.y + 1; }
    const ol = [org?.inn ? `ИНН ${org.inn}${org.kpp ? `; КПП ${org.kpp}` : ''}` : '', org?.phone ? `Тел.: ${org.phone}` : '', org?.email ? `E-mail: ${org.email}` : ''].filter(Boolean).join(' · ');
    if (ol) { d.font('gost-i').fontSize(8.5).fillColor('#333').text(ol, M.l, yy, { width: CW }); yy = d.y; }
    yy = Math.max(yy + 18, 140);
    d.font('gost-i').fontSize(18).fillColor('#000').text(`ПАСПОРТ № ${p.passportNumber ?? ''}`, M.l, yy, { width: CW, align: 'center' });
    d.font('gost-i').fontSize(14).text(p.name ?? '', M.l + 10, d.y + 8, { width: CW - 20, align: 'center' });
    yy = d.y + 6;
    if (p.productCode) { d.font('gost-i').fontSize(10).fillColor('#333').text(`Артикул: ${p.productCode}`, M.l, yy, { width: CW, align: 'center' }); yy = d.y + 6; }
    // плашка категории + возраст «N+» кружком
    const cat = style?.categoryName || p.passportCategory || '';
    const age = has(p.ageFrom) ? `${num(p.ageFrom)}+` : '';
    if (cat || age) {
      d.font('gost').fontSize(10);
      const cw = cat ? d.widthOfString(cat) + 20 : 0, aw = age ? 26 : 0, gap = cat && age ? 8 : 0;
      let x = (A5.w - cw - aw - gap) / 2;
      if (cat) { d.save().fillColor(color).roundedRect(x, yy, cw, 20, 10).fill().restore(); d.font('gost').fontSize(10).fillColor('#fff').text(cat, x, yy + 5, { width: cw, align: 'center', lineBreak: false }); x += cw + gap; }
      if (age) { d.lineWidth(1.4).strokeColor(color).circle(x + 13, yy + 10, 12).stroke(); d.font('gost').fontSize(9).fillColor(color).text(age, x, yy + 5.5, { width: 26, align: 'center', lineBreak: false }); }
      yy += 30;
    }
    const ov = images.overview?.[0];
    const bottom = A5.h - 40;
    if (ov && bottom - yy > 60) { try { d.image(ov.buf, M.l, yy, { fit: [CW, bottom - yy], align: 'center', valign: 'center' }); } catch { /* битая картинка — без неё */ } }
    if (p.certificate?.hasEac) {
      d.lineWidth(1.2).strokeColor('#000').rect(A5.w - M.r - 34, A5.h - 36, 34, 22).stroke();
      d.font('gost').fontSize(12).fillColor('#000').text('EAC', A5.w - M.r - 34, A5.h - 30, { width: 34, align: 'center', lineBreak: false });
    }
    d.save().fillColor(color).rect(0, A5.h - 8, A5.w, 8).fill().restore();
  } }] };
}

// ─────────────────────────── лист для стенда A3 (Э6d) ───────────────────────────

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
