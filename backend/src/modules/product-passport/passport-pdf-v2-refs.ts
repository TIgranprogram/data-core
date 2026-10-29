import { PdfImageV2, NEUTRAL_COLOR } from './passport-pdf-v2-types';

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
  { key: 'callouts', title: 'Общий вид и элементы изделия', kinds: ['overview_callouts', 'nameplate'], perPage: 2 },
  // чертёж с размерами + виды (сетка 2×2 на лист)
  { key: 'views', title: 'Габаритные размеры и виды', kinds: ['dimensions', 'view_front', 'view_side', 'view_top', 'view_3d'], perPage: 4 },
  { key: 'safety_zone', title: 'Зона безопасности', kinds: ['safety_zone'], perPage: 2 },
  // дополнительные «Общий вид» (первый — на обложке)
  { key: 'overview_more', title: 'Общий вид', kinds: ['overview_more'], perPage: 4 },
  { key: 'foundation', title: 'Схемы установки опор', kinds: ['foundation'], perPage: 2 },
  { key: 'holes', title: 'Схема скважин и разметки', kinds: ['holes'], perPage: 2 },
  { key: 'mounting', title: 'Инструкция по монтажу', kinds: ['mounting'], perPage: 2 },
  { key: 'assembly', title: 'Инструкция по сборке', kinds: ['assembly'], perPage: 2 },
];
const KIND_TITLE: Record<string, string> = {
  overview_callouts: 'Общий вид изделия с обозначением элементов', nameplate: 'Место маркировочной таблички',
  dimensions: 'Габаритные размеры', safety_zone: 'Зона безопасности (площадка вокруг изделия)', foundation: 'Схема установки опор',
  holes: 'Схема разметки скважин', safety: 'Требования безопасности при монтаже', mounting: 'Монтаж изделия', assembly: 'Сборка',
  view_front: 'Вид спереди', view_side: 'Вид сбоку', view_top: 'Вид сверху', view_3d: 'Общий вид 3D', overview_more: 'Общий вид',
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
export function planFigures(texts: string[], rawImages: Partial<Record<string, PdfImageV2[]>>, paraTexts: string[] = []): FigurePlan {
  // на обложке — первый «Общий вид», остальные не теряем: приложение «Общий вид»
  const images: Partial<Record<string, PdfImageV2[]>> = { ...rawImages, overview_more: (rawImages.overview || []).slice(1) };
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

