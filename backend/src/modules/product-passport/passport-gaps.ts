import { NotFoundException } from '@nestjs/common';
import { Types, type mongo } from 'mongoose';
import { KINDS_DICT, resolveKind, type ResolvedKind } from '../../common/passport/kind';
import { inheritedPassportCategory } from '../../common/passport/passport-inherit';
import { buildForest, forProduct, resolveChoices, toNode } from '../../common/passport/phrase-tree';
import { groupChain } from './passport-facet-phrases';
import { loadFacets } from './passport-funnel';
import { applicability, facetApplies, productType, USER_FIELDS } from './passport-applicability';

const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Способ установки по умолчанию для категории (код записи справочника «Способы установки»); у благоустройства единого нет. */
export const DEFAULT_INSTALL: Record<string, string> = { TRN: 'EMBEDDED', WRK: 'CONCRETE_POSTS', DIO: 'CONCRETE_POSTS', DSP: 'CONCRETE_POSTS' };

export interface GapItem {
  key: string; label: string; kind: 'category' | 'facet' | 'field' | 'install' | 'elements' | 'purpose' | 'image' | 'kind'; required: boolean;
  multi?: boolean; default?: unknown; options?: Array<{ id: string; label: string }>;
}

/** Элемент для списка «Что это за изделие»: строго по категории (пустая — никому) и только изделие/снаряд (без kind — как изделие до разметки). */
export function elementFits(d: Record<string, unknown>, code: string): boolean {
  const kind = s(d.kind);
  if (kind && kind !== 'product') return false;
  return s(d.categories).split(/[,;\s]+/).filter(Boolean).includes(code);
}

/** У изделия есть элементы: свои (умолчания паспорта), из вида изделия или из выбранных значений признаков. */
async function hasElements(db: mongo.Db, prod: Record<string, unknown>, rk: ResolvedKind): Promise<boolean> {
  if ((((prod.passportDefaults as { elements?: unknown[] } | undefined)?.elements) ?? []).length) return true;
  if (rk.kind?.elementIds.length) return true;
  const have = new Set(((prod.facetValueIds as unknown[]) ?? []).map(String));
  if (!have.size) return false;
  const vals = await db.collection('dict_values').find({ dict: 'productFacetValues', deletedAt: null }, { projection: { elementIds: 1 } }).toArray();
  return vals.some((v) => have.has(String(v._id)) && ((v.elementIds as unknown[]) ?? []).length > 0);
}

/** Вид пункта «не хватает» по ключу поля формы паспорта (правила — passport-rules.ts). */
export function gapKind(key: string): GapItem['kind'] {
  if (key.startsWith('img_')) return 'image';
  if (key === 'installationTypeId') return 'install';
  if (key === 'elements') return 'elements';
  return 'field';
}

type CategoryRule = { name?: string; serviceLifeYears?: string; warrantyMonths?: string; fieldDefaults?: string; requiredFields?: string; requiredImages?: string };

/**
 * Числа категории по умолчанию (C070-П2): «Срок службы», «Гарантия» и строки справочника «Значения полей по умолчанию»
 * («ключ — значение», по строке: heightMin — 1400). Только положительные числа; строки без значения пропускаются.
 */
export function categoryFieldDefaults(rule?: CategoryRule): Record<string, number> {
  const out: Record<string, number> = {};
  const put = (k: string, v: unknown) => { const n = Number(String(v ?? '').replace(',', '.').trim()); if (k && String(v ?? '').trim() && Number.isFinite(n) && n > 0) out[k] = n; };
  for (const line of String(rule?.fieldDefaults ?? '').split(/\r?\n/)) {
    const [k, ...v] = line.trim().split(/\s+[—–-]\s+/);
    if (v.length) put(s(k), v.join(' '));
  }
  put('serviceLifeYears', rule?.serviceLifeYears);
  put('warrantyMonths', rule?.warrantyMonths);
  return out;
}

interface Checker {
  check(body: Record<string, unknown>, usedFields?: Set<string>): Promise<{ missing: Array<{ label: string; key: string }> }>;
  categoryRules(): Promise<Map<string, CategoryRule>>;
}

const catsOf = (d: Record<string, unknown>) => s(d.categories).split(/[,;\s]+/).filter(Boolean);
const fitsCat = (d: Record<string, unknown>, code: string) => d.allCategories === true || d.allCategories === 'true' || catsOf(d).includes(code);

/**
 * Назначение изделия: имя выбранного варианта (от него зависит тип, C086) и пункт «не хватает».
 * Порядок источников (C100): своё у изделия → вид изделия → привязка листа к группе/признакам. Угадывания по названию нет.
 * Сохранённый, но удалённый или не подходящий категории выбор (свой или вида) молча не подменяется — «Выберите назначение заново».
 * Источников нет: тип нужен (`askType`) — обычный вопрос со списком; иначе пункта нет. `ask` — назначение пусто без «заново»
 * (по нему при отсутствии вида задаётся вопрос «Вид изделия»).
 */
async function purposeState(db: mongo.Db, prod: Record<string, unknown>, code: string, rk: ResolvedKind, askType: boolean): Promise<{ chosen: string; gap: GapItem | null; ask: boolean }> {
  const choices = ((prod.passportDefaults as { textChoices?: Record<string, string> } | undefined)?.textChoices) || {};
  const phrases = await db.collection('dict_values').find(
    { dict: 'passportPhrases', deletedAt: null },
    { projection: { name: 1, parentId: 1, section: 1, categories: 1, allCategories: 1, text: 1, groupIds: 1, facetValueIds: 1, isDefault: 1, order: 1 } },
  ).toArray();
  const root = phrases.find((p) => s(p.section) === 'purpose' && !p.parentId && !s(p.text));
  if (!root) return { chosen: '', gap: null, ask: false };
  const leaves = phrases.filter((p) => String(p.parentId) === String(root._id));
  const picked = choices[String(root._id)];
  const selected = leaves.find((l) => String(l._id) === String(picked));
  if (selected && fitsCat(selected, code)) return { chosen: s(selected.name), gap: null, ask: false };
  const options = leaves.filter((l) => fitsCat(l, code)).map((l) => ({ id: String(l._id), label: s(l.name) }));
  const base = { key: `choice:${String(root._id)}`, label: 'Назначение', kind: 'purpose' as const, required: false, options };
  const redo = (why: string): GapItem => ({ ...base, required: true, label: `Выберите назначение заново: ${why}` });
  if (picked) return { chosen: '', gap: redo('сохранённый вариант удалён или не подходит категории'), ask: false };
  const viaKind = rk.kind?.purposeLeafId;
  if (viaKind) {
    const leaf = leaves.find((l) => String(l._id) === viaKind);
    if (leaf && fitsCat(leaf, code)) return { chosen: s(leaf.name), gap: null, ask: false };
    return { chosen: '', gap: redo(`назначение вида «${rk.kind!.name}» удалено или не подходит категории`), ask: false };
  }
  // тот же выбор по группе/признакам, что и в PDF: автоматическое назначение уже заполнено
  const groupIds = phrases.some((p) => Array.isArray(p.groupIds) && p.groupIds.length) ? await groupChain(db, prod.categoryId) : new Set<string>();
  const ctx = { facetValueIds: new Set(((prod.facetValueIds as unknown[]) ?? []).map(String)), groupIds };
  const forest = forProduct(buildForest(phrases.map(toNode), code), ctx);
  const auto = resolveChoices(forest, choices, ctx).leaves.get(String(root._id));
  if (auto) return { chosen: auto.leaf.name, gap: null, ask: false };
  return { chosen: '', gap: askType && options.length ? base : null, ask: askType && options.length > 0 };
}

/**
 * «Чего не хватает» для паспорта изделия (A3): только пустое у изделия. Обязательные поля и рисунки — те же правила, что
 * у проверки перед выпуском (`check`, режим шаблона); плюс признаки категории без значения и умолчания категории.
 */
export async function productGaps(svc: Checker, db: mongo.Db, id: string) {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Изделие не найдено');
  const prod = await db.collection('products').findOne({ _id: new Types.ObjectId(id), deletedAt: null });
  if (!prod) throw new NotFoundException('Изделие не найдено');
  const rk = await resolveKind(db, prod);
  const kindInfo = rk.kind ? { id: rk.kind.id, name: rk.kind.name, source: rk.source, groupName: rk.groupName } : null;
  // категория: своя → вида изделия → группы/раздела (C100)
  const own = s((prod.passportDefaults as { passportCategory?: string } | undefined)?.passportCategory);
  const viaKind = own ? '' : s(rk.kind?.passportCategory);
  const inh = own || viaKind ? null : await inheritedPassportCategory(db, prod.categoryId as Types.ObjectId | undefined);
  const code = own || viaKind || inh?.code || null;
  const rules = await svc.categoryRules();
  if (!code) {
    const options = [...rules.entries()].filter(([c]) => c !== 'ALL').map(([c, r]) => ({ id: c, label: s(r.name) || c }));
    return { category: { code: null, name: null, source: null }, kind: kindInfo, missing: [{ key: 'category', label: 'Тип паспорта', kind: 'category' as const, required: true, options }] as GapItem[] };
  }
  const category = { code, name: s(rules.get(code)?.name) || (inh?.name ?? code), source: (own ? 'own' : viaKind ? 'kind' : 'group') as 'own' | 'kind' | 'group' };
  const group = rk.groupName;

  const missing: GapItem[] = [];
  // признаки категории без значения у изделия
  const { facets, values } = await loadFacets(db);
  const have = new Set(((prod.facetValueIds as unknown[]) ?? []).map(String));
  // C086: тип изделия — выбранное назначение, конкретная группа каталога или запасной признак типа; подсказка по названию типом не считается
  const facetCodes = facets.filter((f) => values.some((v) => v.parentId === f.id && have.has(v.id))).map((f) => f.code);
  const untyped = productType(code, { facetCodes, group });
  const purpose = await purposeState(db, prod, code, rk, untyped.needed && !untyped.known);
  const type = productType(code, { purposeName: purpose.chosen, facetCodes, group });
  for (const f of facets.filter((x) => x.category === code && facetApplies(x.code, type)).sort((a, b) => a.order - b.order)) {
    const vals = values.filter((v) => v.parentId === f.id).sort((a, b) => a.order - b.order);
    if (!vals.length || vals.some((v) => have.has(v.id))) continue;
    missing.push({ key: f.code, label: f.name, kind: 'facet', required: false, multi: f.multi, options: vals.map((v) => ({ id: v.id, label: v.name })) });
  }
  // обязательные поля и рисунки категории
  const usedFields = new Set<string>();
  let rows = (await svc.check({ productId: id, mode: 'template' }, usedFields)).missing.filter((m) => !m.key.startsWith('choice:') && m.key !== 'category');
  // C028: элементы дают признаки (elementIds значений) — шаг нужен, только если у изделия их нет ни своих, ни из признаков
  if (rows.some((m) => m.key === 'elements') && (await hasElements(db, prod, rk))) rows = rows.filter((m) => m.key !== 'elements');
  const [installs, elements] = rows.some((m) => m.key === 'installationTypeId' || m.key === 'elements')
    ? await Promise.all([
      db.collection('dict_values').find({ dict: 'passportInstall', deletedAt: null }, { projection: { name: 1, code: 1, categories: 1 } }).toArray(),
      db.collection('dict_values').find({ dict: 'passportElements', deletedAt: null }, { projection: { name: 1, categories: 1, kind: 1 } }).toArray(),
    ]) : [[], []];
  const forCat = (d: Record<string, unknown>) => { const l = s(d.categories).split(/[,;\s]+/).filter(Boolean); return !l.length || l.includes(code); };
  const defaults = categoryFieldDefaults(rules.get(code));
  for (const m of rows) {
    const kind = gapKind(m.key);
    const item: GapItem = { key: m.key, label: m.label, kind, required: true };
    if (kind === 'install') {
      item.options = installs.filter(forCat).map((d) => ({ id: String(d._id), label: s(d.name) })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
      const def = installs.find((d) => s(d.code) === DEFAULT_INSTALL[code]);
      if (def) item.default = { id: String(def._id), label: s(def.name) };
    } else if (kind === 'elements') {
      item.options = elements.filter((d) => elementFits(d, code)).map((d) => ({ id: String(d._id), label: s(d.name) })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
    } else if (kind === 'field' && defaults[m.key] !== undefined) item.default = defaults[m.key];
    missing.push(item);
  }
  if (purpose.gap) missing.push(purpose.gap);
  // нет вида, а элементы или назначение пусты — один вопрос «Вид изделия» (C100): виды этой категории, нет таких — все
  if (!rk.kind && (purpose.ask || missing.some((m) => m.kind === 'elements'))) {
    const all = await db.collection('dict_values').find({ dict: KINDS_DICT, deletedAt: null }, { projection: { name: 1, passportCategory: 1 } }).toArray();
    const fit = all.filter((k) => s(k.passportCategory) === code);
    const options = (fit.length ? fit : all).map((k) => ({ id: String(k._id), label: s(k.name) })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
    missing.unshift({ key: 'kind', label: 'Вид изделия', kind: 'kind', required: true, options });
  }
  const applicable = applicability(code, rules.get(code), type);
  for (const key of usedFields) if (USER_FIELDS.includes(key)) applicable.fields[key] = 'required';
  // поле, которого ждёт текст именно этого изделия (подстановка {maxUsers} в правилах для качелей и т. п.), применимо и обязательно
  for (const m of missing) if (m.kind === 'field' && m.required && USER_FIELDS.includes(m.key)) applicable.fields[m.key] = 'required';
  return { category, kind: kindInfo, missing, applicable };
}
