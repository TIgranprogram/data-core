import { NotFoundException } from '@nestjs/common';
import { Types, type mongo } from 'mongoose';
import { suggestValue } from '../../common/passport/funnel';
import { inheritedPassportCategory } from '../../common/passport/passport-inherit';
import { loadFacets } from './passport-funnel';

const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Способ установки по умолчанию для категории (код записи справочника «Способы установки»); у благоустройства единого нет. */
export const DEFAULT_INSTALL: Record<string, string> = { TRN: 'EMBEDDED', WRK: 'CONCRETE_POSTS', DIO: 'CONCRETE_POSTS', DSP: 'CONCRETE_POSTS' };

export interface GapItem {
  key: string; label: string; kind: 'category' | 'facet' | 'field' | 'install' | 'elements' | 'image'; required: boolean;
  multi?: boolean; default?: unknown; suggest?: { id: string; label: string; word: string }; options?: Array<{ id: string; label: string }>;
}

/** Элемент для списка «Что это за изделие»: строго по категории (пустая — никому) и только изделие/снаряд (без kind — как изделие до разметки). */
export function elementFits(d: Record<string, unknown>, code: string): boolean {
  const kind = s(d.kind);
  if (kind && kind !== 'product') return false;
  return s(d.categories).split(/[,;\s]+/).filter(Boolean).includes(code);
}

/** У изделия есть элементы: свои (умолчания паспорта) или из выбранных значений признаков. */
async function hasElements(db: mongo.Db, prod: Record<string, unknown>): Promise<boolean> {
  if ((((prod.passportDefaults as { elements?: unknown[] } | undefined)?.elements) ?? []).length) return true;
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

type CategoryRule = { name?: string; serviceLifeYears?: string; warrantyMonths?: string; fieldDefaults?: string };

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
  check(body: Record<string, unknown>): Promise<{ missing: Array<{ label: string; key: string }> }>;
  categoryRules(): Promise<Map<string, CategoryRule>>;
}

/**
 * «Чего не хватает» для паспорта изделия (A3): только пустое у изделия. Обязательные поля и рисунки — те же правила, что
 * у проверки перед выпуском (`check`, режим шаблона); плюс признаки категории без значения и умолчания категории.
 */
export async function productGaps(svc: Checker, db: mongo.Db, id: string) {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Изделие не найдено');
  const prod = await db.collection('products').findOne({ _id: new Types.ObjectId(id), deletedAt: null });
  if (!prod) throw new NotFoundException('Изделие не найдено');
  const own = s((prod.passportDefaults as { passportCategory?: string } | undefined)?.passportCategory);
  const inh = own ? null : await inheritedPassportCategory(db, prod.categoryId as Types.ObjectId | undefined);
  const code = own || inh?.code || null;
  const rules = await svc.categoryRules();
  if (!code) {
    const options = [...rules.entries()].filter(([c]) => c !== 'ALL').map(([c, r]) => ({ id: c, label: s(r.name) || c }));
    return { category: { code: null, name: null, source: null }, missing: [{ key: 'category', label: 'Категория паспорта', kind: 'category' as const, required: true, options }] as GapItem[] };
  }
  const category = { code, name: s(rules.get(code)?.name) || (inh?.name ?? code), source: (own ? 'own' : 'group') as 'own' | 'group' };

  const missing: GapItem[] = [];
  // признаки категории без значения у изделия
  const { facets, values } = await loadFacets(db);
  const have = new Set(((prod.facetValueIds as unknown[]) ?? []).map(String));
  for (const f of facets.filter((x) => x.category === code).sort((a, b) => a.order - b.order)) {
    const vals = values.filter((v) => v.parentId === f.id).sort((a, b) => a.order - b.order);
    if (!vals.length || vals.some((v) => have.has(v.id))) continue;
    const suggest = suggestValue(s(prod.name), vals);
    missing.push({ key: f.code, label: f.name, kind: 'facet', required: false, multi: f.multi, ...(suggest ? { suggest } : {}), options: vals.map((v) => ({ id: v.id, label: v.name })) });
  }
  // обязательные поля и рисунки категории
  let rows = (await svc.check({ productId: id, mode: 'template' })).missing.filter((m) => !m.key.startsWith('choice:') && m.key !== 'category');
  // C028: элементы дают признаки (elementIds значений) — шаг нужен, только если у изделия их нет ни своих, ни из признаков
  if (rows.some((m) => m.key === 'elements') && (await hasElements(db, prod))) rows = rows.filter((m) => m.key !== 'elements');
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
  return { category, missing };
}
