/**
 * Части текста паспорта v2 из справочников «Паспорта» (БЗ-6 Э3c) — чистые функции без БД.
 * Записи справочников (dict_values) приходят с полями на верхнем уровне и с `id` или `_id`.
 * Все функции терпимы к пустым и отсутствующим полям.
 */

export type DictRec = { id?: unknown; _id?: unknown; code?: string; name?: string; [k: string]: unknown };

export interface PassportLike {
  name?: string;
  elements?: unknown[];
  materialIds?: unknown[];
  installationTypeId?: unknown;
  [k: string]: unknown;
}

export type Period = 'ежедневно' | 'ежемесячно' | 'ежеквартально' | 'ежегодно';
export const PERIODS: Period[] = ['ежедневно', 'ежемесячно', 'ежеквартально', 'ежегодно'];

export interface MaintenanceRow { what: string; where: string; measure: string; tolerance: string }
export interface MaintenanceTable { period: Period; rows: MaintenanceRow[] }
export interface InstallParts { text: string; requirements: string[]; requiredImages: string[] }

const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** Строка с переводами строк или массив → непустые строки. */
function lines(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\r?\n/) : [];
  return arr.map((x) => str(x)).filter(Boolean);
}

/** Список через запятую/точку с запятой или массив → непустые значения. */
function csv(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;]/) : [];
  return arr.map((x) => str(x)).filter(Boolean);
}

function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of items) {
    const k = s.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}

const recId = (r: DictRec): string => String(r.id ?? r._id ?? '');
const stripEnd = (s: string): string => s.replace(/[\s.,;:]+$/, '');

/** Записи справочника, id которых есть в списке; порядок — как в списке id, без повторов. */
function pick(ids: unknown[] | undefined, recs: DictRec[] | undefined): DictRec[] {
  const byId = new Map<string, DictRec>();
  for (const r of recs || []) if (r) byId.set(recId(r), r);
  const out: DictRec[] = [];
  const used = new Set<string>();
  for (const raw of ids || []) {
    const id = String(raw ?? '');
    const r = byId.get(id);
    if (r && !used.has(id)) { used.add(id); out.push(r); }
  }
  return out;
}

/** Перечисление «а, б и в». */
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`;
}

/** Описание: «<Наименование> (далее — изделие) состоит из …; изготовлено из … и ….» */
export function describeProduct(passport: PassportLike, elements: DictRec[], materials: DictRec[]): string {
  const name = str(passport?.name);
  const parts = uniq(pick(passport?.elements, elements).map((e) => stripEnd(str(e.inDescription))).filter(Boolean));
  const mats = uniq(pick(passport?.materialIds, materials).map((m) => stripEnd(str(m.madeOf))).filter(Boolean));
  const head = name ? `${stripEnd(name)} (далее — изделие)` : 'Изделие';
  const clauses: string[] = [];
  if (parts.length) clauses.push(`состоит из: ${parts.join(', ')}`);
  if (mats.length) clauses.push(`изготовлено из ${joinAnd(mats)}`);
  if (!clauses.length) return name ? `${head}.` : '';
  return `${head} ${clauses.join('; ')}.`;
}

/** «Предназначено для: …» из назначений элементов (без дублей). Пусто, если назначений нет. */
export function purposeText(elements: DictRec[]): string {
  const items = uniq((elements || []).map((e) => stripEnd(str(e?.purpose))).filter(Boolean));
  return items.length ? `Предназначено для: ${items.join('; ')}.` : '';
}

/** Шаги раздела «Правила пользования»: уникальные строки из правил элементов. */
export function usageRules(elements: DictRec[]): string[] {
  return uniq((elements || []).flatMap((e) => lines(e?.usageRules ?? e?.rules)));
}

function normPeriod(v: unknown): Period | null {
  const s = str(v).toLowerCase();
  return (PERIODS as string[]).includes(s) ? (s as Period) : null;
}

/**
 * Таблицы ТО по периодам (от частого к редкому, пустые не выводятся). Дефект берётся, если его `applies`
 * пересекается с кодами материалов/элементов изделия (или способа установки). Пункты «что проверять при ТО»
 * из элементов добавляются строками ежемесячной таблицы без меры, если такого дефекта нет.
 */
export function maintenanceTables(
  materials: DictRec[],
  elements: DictRec[],
  defects: DictRec[],
  install?: DictRec | null,
): MaintenanceTable[] {
  const owners = new Map<string, string[]>(); // код → имена элементов/материалов
  const add = (r: DictRec) => {
    const code = str(r?.code);
    if (!code) return;
    const list = owners.get(code) || [];
    const n = str(r.name) || code;
    if (!list.includes(n)) list.push(n);
    owners.set(code, list);
  };
  (materials || []).forEach(add);
  (elements || []).forEach(add);
  const installCode = str(install?.code);

  const buckets = new Map<Period, MaintenanceRow[]>();
  const push = (p: Period, row: MaintenanceRow) => {
    const b = buckets.get(p) || [];
    b.push(row);
    buckets.set(p, b);
  };
  const defectNames = new Set<string>();

  for (const d of defects || []) {
    const period = normPeriod(d?.period);
    const what = str(d?.name) || str(d?.code);
    if (!period || !what) continue;
    const applies = csv(d.applies);
    const where: string[] = [];
    for (const code of applies) for (const n of owners.get(code) || []) if (!where.includes(n)) where.push(n);
    const viaInstall = !!installCode && applies.includes(installCode);
    if (!where.length && !viaInstall) continue;
    if (!where.length && viaInstall) where.push(str(install?.name) || installCode);
    defectNames.add(what.toLowerCase());
    push(period, { what, where: where.join(', '), measure: str(d.measure), tolerance: str(d.tolerance) });
  }

  for (const e of elements || []) {
    const owner = str(e?.name) || str(e?.code);
    for (const c of lines(e?.inspect ?? e?.checks)) {
      if (defectNames.has(c.toLowerCase())) continue;
      push('ежемесячно', { what: c, where: owner, measure: '', tolerance: '' });
    }
  }

  return PERIODS.filter((p) => (buckets.get(p) || []).length).map((p) => ({ period: p, rows: buckets.get(p)! }));
}

/** Монтаж: текст по шагам, требования к основанию и обязательные рисунки. */
export function installText(install: DictRec | null | undefined): InstallParts {
  if (!install) return { text: '', requirements: [], requiredImages: [] };
  return {
    text: lines(install.montage ?? install.mountText).join('\n'),
    requirements: lines(install.baseRequirements),
    requiredImages: uniq(lines(install.requiredImages).flatMap((s) => csv(s))),
  };
}
