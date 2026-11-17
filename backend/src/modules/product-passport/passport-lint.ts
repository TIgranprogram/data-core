/**
 * C137 Э1: автопроверка текста паспорта на противоречия — чистая функция над собранным текстом (`textSnapshot`) и карточкой.
 * Ничего не меняет и не блокирует сама: решает вызывающий (`lintMode`: warn — только список, error — ошибки не дают выпустить).
 */
export type LintSeverity = 'error' | 'warn';
export interface LintFinding { code: string; severity: LintSeverity; where: string; text: string }

interface SnapItem { key?: string; number?: string | null; bullet?: boolean; text?: string }
interface SnapSection { key?: string; number?: string; title?: string; items?: SnapItem[] }
interface SnapRow { what?: string; where?: string; measure?: string; tolerance?: string }
/** Нужная часть `textSnapshot` / результата сборки текста. */
export interface LintText {
  description?: string; purpose?: string; rules?: string[];
  maintenance?: Array<{ period?: string; rows?: SnapRow[] }>;
  install?: { text?: string; requiredImages?: string[] };
  sections?: SnapSection[]; traits?: string[];
}
/** Что известно о карточке (всё необязательно: нет данных — правило пропускается). */
export interface LintCard {
  name?: string;
  joints?: string[];
  /** Названия покрытий изделия («Защитное масло»); нет — смотрим описание. */
  coatingText?: string;
  /** Названия видов/узлов изделия — чужие в чек-листе. */
  elementNames?: string[];
  /** Виды рисунков паспорта (overview, foundation…). */
  imageKinds?: string[];
  /** Имя на талоне, если печатается отдельно. */
  ticketName?: string;
  /** Подписи рисунков монтажа. */
  captions?: string[];
}

export const LINT_MODES = ['warn', 'error'] as const;
export type LintMode = (typeof LINT_MODES)[number];
/** Режим проверки при выпуске: по умолчанию warn — выпуск не блокируется (решение 2026-11-16). */
export const lintMode = (env: Record<string, string | undefined> = process.env): LintMode => (env.PASSPORT_LINT_MODE === 'error' ? 'error' : 'warn');

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/[.;:\s]+$/, '').trim();
const NB = '(?<![а-яёА-ЯЁ])'; // граница слова: \b в JS не работает с кириллицей

const STOP: Array<{ re: RegExp; label: string }> = [
  { re: /при\s+их\s+наличии/i, label: 'при их наличии' },
  { re: /при\s+наличии/i, label: 'при наличии' },
  { re: /если\s+опоры/i, label: 'если опоры' },
  { re: /—\s*—/, label: '— —' },
  { re: new RegExp(`${NB}Стелл[аыуе](?![а-яё])`), label: 'Стелла' },
  { re: /\d\s*[хx]\s*\d/i, label: '«х» между числами вместо «×»' },
];

/** Слово → когда оно допустимо (есть признак в карточке). Нет данных о карточке — слово не проверяется. */
const NEEDS: Array<{ re: RegExp; word: string; ok: (c: Ctx) => boolean | null }> = [
  { re: /сварн/i, word: 'сварн…', ok: (c) => (c.traits ? c.traits.includes('welds') || c.joints.includes('welds') : null) },
  { re: /лакокрасочн/i, word: 'лакокрасочн…', ok: (c) => /лак|краск|эмал/i.test(c.coating) },
  { re: /коррози/i, word: 'коррози…', ok: (c) => (c.traits ? c.traits.includes('metal') : null) },
  { re: /закладн/i, word: 'закладн…', ok: (c) => (c.traits ? c.traits.includes('anchors') || c.traits.includes('concrete') : null) },
  { re: /анкер/i, word: 'анкер…', ok: (c) => (c.traits ? c.traits.includes('anchors') : null) },
];
interface Ctx { traits: string[] | null; joints: string[]; coating: string }

/** Способ установки по тексту одного места; не определён или сразу несколько — null (общая фраза). */
export function installKindIn(text: string): 'concrete' | 'anchor' | null {
  const c = /бетон/i.test(text); const a = /анкер|шпильк/i.test(text);
  return c === a ? null : c ? 'concrete' : 'anchor';
}
const KIND_LABEL = { concrete: 'бетонирование', anchor: 'анкеры / шпильки' } as const;

const TABLES = new Set(['specs', 'bom', 'storage', 'faults', 'service', 'repairs']);

/** Все места текста паспорта: где (для человека) и текст. */
function places(t: LintText): Array<{ where: string; text: string; area: string }> {
  const out: Array<{ where: string; text: string; area: string }> = [];
  const put = (area: string, where: string, text?: string) => { if (String(text ?? '').trim()) out.push({ area, where, text: String(text) }); };
  put('desc', 'Описание изделия', t.description);
  put('purpose', 'Назначение', t.purpose);
  (t.rules ?? []).forEach((r, i) => put('rule', `Правила пользования, пункт ${i + 1}`, r));
  put('install', 'Способ установки', t.install?.text);
  for (const s of t.sections ?? []) {
    for (const it of s.items ?? []) put(s.key === 'mounting' ? 'mounting' : 'item', `п. ${it.number ?? '—'} «${s.title ?? s.key}»`, it.text);
  }
  for (const m of t.maintenance ?? []) for (const r of m.rows ?? []) put('row', `Чек-лист (${m.period}): «${r.what ?? ''}»`, [r.what, r.where, r.measure, r.tolerance].filter(Boolean).join('. '));
  return out;
}

export function lintPassportText(text: LintText | null | undefined, card: LintCard = {}): LintFinding[] {
  const t = text ?? {};
  const out: LintFinding[] = [];
  const add = (code: string, severity: LintSeverity, where: string, msg: string) => out.push({ code, severity, where, text: msg });
  const all = places(t);

  // 1. способ установки одинаков во всех местах
  const kinds = new Map<'concrete' | 'anchor', string[]>();
  for (const p of all) {
    if (!['desc', 'install', 'mounting', 'row'].includes(p.area)) continue;
    const k = installKindIn(p.text);
    if (k) kinds.set(k, [...(kinds.get(k) ?? []), p.where]);
  }
  for (const cap of card.captions ?? []) { const k = installKindIn(cap); if (k) kinds.set(k, [...(kinds.get(k) ?? []), `Подпись рисунка «${cap}»`]); }
  if (kinds.size > 1) {
    const list = [...kinds].map(([k, w]) => `${KIND_LABEL[k]} — ${w.slice(0, 3).join('; ')}`).join(' | ');
    add('install-mismatch', 'error', [...kinds.values()].flat()[0], `Способ установки назван по-разному: ${list}`);
  }

  // 2. стоп-слова
  for (const p of all) for (const s of STOP) if (s.re.test(p.text)) add('stop-word', 'warn', p.where, `Оговорка «${s.label}»: пункт должен либо быть, либо не быть`);

  // 3. слова, не подтверждённые карточкой
  const ctx: Ctx = { traits: t.traits ?? null, joints: card.joints ?? [], coating: card.coatingText ?? t.description ?? '' };
  for (const p of all) for (const n of NEEDS) {
    if (n.re.test(p.text) && n.ok(ctx) === false) add('word-unsupported', 'warn', p.where, `Слово «${n.word}» есть в тексте, а в карточке изделия такого нет`);
  }

  // 4. чек-лист: пустые Мера / Допуск, чужие узлы
  const own = (card.elementNames ?? []).map(norm).filter(Boolean);
  for (const m of t.maintenance ?? []) for (const r of m.rows ?? []) {
    const w = `Чек-лист (${m.period}): «${r.what ?? ''}»`;
    const noM = !String(r.measure ?? '').trim(); const noT = !String(r.tolerance ?? '').trim();
    if (noM && noT) add('checklist-empty', 'error', w, 'Нет ни «Что сделать», ни «Нормы» — строка не печатается без них');
    else if (noM || noT) add('checklist-empty', 'warn', w, noM ? 'Не заполнено «Что сделать при отклонении»' : 'Не заполнена «Норма»');
    const where = norm(r.where);
    if (own.length && where && !own.some((o) => where.includes(o) || o.includes(where)) && !/древесин|металл|бетон|материал/i.test(r.where ?? '') ) add('checklist-foreign', 'warn', w, `Узел «${r.where}» не относится к виду изделия`);
  }

  // 5. ссылки на несуществующее
  const periods = new Set((t.maintenance ?? []).map((m) => String(m.period ?? '')));
  const figs = new Set([...(card.imageKinds ?? []), ...(t.install?.requiredImages ?? [])]);
  for (const p of all) {
    for (const m of p.text.matchAll(/\{tab:([^}]+)\}/g)) {
      const k = m[1];
      const ok = TABLES.has(k) || (k.startsWith('to:') ? periods.has(k.slice(3)) : false);
      if (!ok) add('ref-missing', 'error', p.where, `Ссылка на таблицу «${k}», которой в паспорте нет`);
    }
    if (card.imageKinds) for (const m of p.text.matchAll(/\{fig:([^}]+)\}/g)) if (!figs.has(m[1])) add('ref-missing', 'warn', p.where, `Ссылка на рисунок «${m[1]}», которого в паспорте нет`);
  }

  // 6. имя одинаково: обложка, 3.1, 14.1, талон
  if (card.name) {
    const secItems = (key: string) => (t.sections ?? []).find((s) => s.key === key)?.items ?? [];
    const found: Array<[string, string]> = [];
    const g1 = (secItems('general')[0]?.text ?? '').match(/:\s*(.+?)\.?$/); if (g1) found.push(['п. 3.1', g1[1]]);
    const a1 = (secItems('acceptance')[0]?.text ?? '').match(/Наименование изделия:\s*(.+?)\.?$/); if (a1) found.push(['п. 14.1', a1[1]]);
    if (card.ticketName) found.push(['Талон', card.ticketName]);
    for (const [w, v] of found) if (norm(v) !== norm(card.name)) add('name-mismatch', 'error', w, `Имя «${v}» не совпадает с обложкой «${card.name}»`);
  }

  // 7. дубли и абзацы без номера
  const seen = new Map<string, string>();
  const titles = new Map<string, string>();
  for (const s of t.sections ?? []) {
    const tk = norm(s.title); if (tk) { if (titles.has(tk)) add('dup-heading', 'warn', `Раздел ${s.number ?? ''} «${s.title}»`, `Такой же заголовок уже есть: раздел ${titles.get(tk)}`); else titles.set(tk, String(s.number ?? '')); }
    for (const it of s.items ?? []) {
      const w = `п. ${it.number ?? '—'} «${s.title}»`;
      const k = norm(it.text);
      if (!it.bullet && k.length > 25) { if (seen.has(k)) add('dup-paragraph', 'warn', w, `Тот же абзац уже есть: ${seen.get(k)}`); else seen.set(k, w); }
      if (!it.bullet && !it.number && k) add('no-number', 'warn', w, 'Абзац без номера');
    }
  }
  return out;
}
