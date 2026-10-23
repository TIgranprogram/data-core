// Не рантайм: используется scripts/clean-auto-articles.js (через dist). Не удалять как неиспользуемый (ARCH-PLAN М4).
/**
 * Чистка автоартикулов (TASKS АР-Ч): `СКЛ-…` в поле «Артикул» → настоящий артикул поставщика из заявок, ничего не теряя.
 * Чистые функции — их же вызывает `backend/scripts/clean-auto-articles.js` (через dist), покрыты юнит-тестами.
 *
 * Группы:
 *  A — артикул из заявок, связанных с позицией (materialId), один, свободен → применяется;
 *  B — по точному совпадению названия (без регистра и пробелов), один, свободен → применяется только по решению;
 *  C — в заявках несколько разных артикулов → решает пользователь;
 *  D — опасные: артикул уже у другой позиции (или его хотят две позиции) → не применять, показать пару;
 *  E — пропуск по Ч.1: позиция правилась в приложении (editedInApp) или свой (не СКЛ-…) артикул.
 * Меняются только `article`, `internalArticle` (внутренний код = старый СКЛ-…) и `sku`, если пуст.
 */
import { isAutoArticle } from './article';

export type CleanGroup = 'A' | 'B' | 'C' | 'D' | 'E';
export interface MatIn { _id: string; name: string; article?: string | null; sku?: string | null; internalArticle?: string | null; editedInApp?: boolean; deletedAt?: unknown }
export interface ReqIn { materialId?: string | null; title?: string | null; article?: string | null; num?: number | null }
export interface CleanRow { id: string; name: string; now: string; next: string | null; group: CleanGroup; source: string; reason: string; pair?: string }

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
/** Артикул пригоден: не пустой, не СКЛ-…, не «—», без лишних пробелов по краям / внутри. */
export function cleanArticle(a: unknown): string | null {
  const s = String(a ?? '').replace(/\s+/g, ' ').trim();
  if (!s || /^[-—–.]+$/.test(s) || isAutoArticle(s)) return null;
  return s;
}

export function classify(mats: MatIn[], reqs: ReqIn[], opts: { includeEdited?: boolean } = {}): CleanRow[] {
  const live = mats.filter((m) => !m.deletedAt);
  const byId = new Map(live.map((m) => [String(m._id), m]));
  const byName = new Map<string, MatIn[]>();
  for (const m of live) { const k = norm(m.name); byName.set(k, [...(byName.get(k) ?? []), m]); }
  // заявки → кандидаты: по связи (1) и по точному названию (2)
  const link = new Map<string, Map<string, number[]>>(), named = new Map<string, Map<string, number[]>>();
  const add = (map: Map<string, Map<string, number[]>>, id: string, a: string, num?: number | null) => {
    const m = map.get(id) ?? new Map<string, number[]>(); m.set(a, [...(m.get(a) ?? []), num ?? 0]); map.set(id, m);
  };
  for (const r of reqs) {
    const a = cleanArticle(r.article);
    if (!a) continue;
    if (r.materialId && byId.has(String(r.materialId))) add(link, String(r.materialId), a, r.num);
    else { const same = byName.get(norm(r.title)); if (same?.length === 1) add(named, String(same[0]._id), a, r.num); }
  }
  // кто уже владеет артикулом (свой, не СКЛ-…)
  const owner = new Map<string, MatIn>();
  for (const m of live) { const a = cleanArticle(m.article); if (a) owner.set(norm(a), m); }
  const rows: CleanRow[] = [];
  for (const m of live) {
    const fromLink = link.get(String(m._id)), fromName = named.get(String(m._id));
    const cand = fromLink ?? fromName;
    if (!cand) continue;
    const list = [...cand.keys()];
    const src = (a: string) => `${fromLink ? 'заявки по связи' : 'заявки по названию'} №${cand.get(a)!.filter(Boolean).join(', ') || '—'}`;
    const base = { id: String(m._id), name: m.name, now: String(m.article ?? '') };
    if (!isAutoArticle(m.article)) {
      if (list.length === 1 && norm(list[0]) === norm(m.article)) continue; // уже правильный
      rows.push({ ...base, next: list.join(' | '), group: 'E', source: src(list[0]), reason: 'у позиции свой артикул — не трогаем' });
      continue;
    }
    if (m.editedInApp && !opts.includeEdited) { rows.push({ ...base, next: list.join(' | '), group: 'E', source: src(list[0]), reason: 'правилась в приложении (Ч.1) — пропуск' }); continue; }
    if (list.length > 1) { rows.push({ ...base, next: list.join(' | '), group: 'C', source: list.map(src).join('; '), reason: 'несколько разных артикулов — решает пользователь' }); continue; }
    const a = list[0];
    const own = owner.get(norm(a));
    if (own && String(own._id) !== String(m._id)) { rows.push({ ...base, next: a, group: 'D', source: src(a), reason: 'артикул уже у другой позиции', pair: own.name }); continue; }
    rows.push({ ...base, next: a, group: fromLink ? 'A' : 'B', source: src(a), reason: '' });
  }
  // две позиции хотят один и тот же новый артикул — обе в D
  const want = new Map<string, CleanRow[]>();
  for (const r of rows) if ((r.group === 'A' || r.group === 'B') && r.next) want.set(norm(r.next), [...(want.get(norm(r.next)) ?? []), r]);
  for (const list of want.values()) if (list.length > 1) for (const r of list) { r.group = 'D'; r.reason = 'тот же артикул нужен нескольким позициям'; r.pair = list.filter((x) => x !== r).map((x) => x.name).join('; '); }
  return rows.sort((x, y) => x.group.localeCompare(y.group) || x.name.localeCompare(y.name, 'ru'));
}

/** Что записать в позицию (Ч.1): новый артикул; старый СКЛ-… → внутренний код; sku — только если пуст. Условие — «article всё ещё старый» (Ч.5). */
export function updateFor(row: CleanRow, mat: MatIn) {
  const old = String(mat.article ?? '');
  const set: Record<string, unknown> = { article: row.next, articleSource: 'чистка артикулов', articleSetAt: new Date() };
  if (old && !mat.internalArticle) set.internalArticle = old;
  if (old && !mat.sku) set.sku = old;
  return { id: String(mat._id), oldArticle: old, set };
}

/** Запись файла отката (Ч.4б): всё, что меняется, — до изменения. */
export const beforeOf = (m: MatIn) => ({ id: String(m._id), article: m.article ?? null, sku: m.sku ?? null, internalArticle: m.internalArticle ?? null });

/** Откат (Ч.7): вернуть только там, где артикул всё ещё тот, что поставила чистка (никого не перетираем). */
export function rollbackFor(before: ReturnType<typeof beforeOf>, current: MatIn) {
  const set: Record<string, unknown> = { article: before.article };
  const unset: Record<string, ''> = { articleSource: '', articleSetAt: '' };
  if (before.internalArticle === null) unset.internalArticle = ''; else set.internalArticle = before.internalArticle;
  if (before.sku === null) unset.sku = ''; else set.sku = before.sku;
  return { id: String(current._id), expectArticle: current.article ?? null, set, unset };
}
