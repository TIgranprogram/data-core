import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { PdmMeta } from '../../common/catalog/pdm-meta.dto';
import type { PdmDecision, PdmItemDto } from './dto/pdm-tree.dto';
import { dimensionsOf, type FieldConflict, type PlannedLine, type SiteLine } from './pdm-plan';
import type { PlanRaw, SiteDoc } from './pdm-plan-rows';

/** Сборка документов для записи (без обращений к базе). */

/** Откуда загружено: версия файла в PDM (пустое не пишем). */
export function pdmMeta(item: PdmItemDto, at = new Date()): PdmMeta {
  const m: PdmMeta = { syncedAt: at };
  if (item.file?.id != null) m.fileId = item.file.id;
  if (item.file?.version != null) m.version = item.file.version;
  if (item.file?.state) m.state = item.file.state;
  if (item.file?.path) m.path = item.file.path;
  if (item.config) m.configuration = item.config;
  return m;
}

/** Строки состава для записи: у существующих строк с той же ссылкой сохраняем `_id`, примечание, цену и прочее. */
export function storedLines(lines: PlannedLine[], existing: SiteLine[] = []): Array<Record<string, unknown>> {
  const had = new Map(existing.map((l) => [`${l.lineType}:${String(l.refId)}`, l]));
  return lines.map((l, i) => {
    const old = had.get(`${l.lineType}:${l.ref}`);
    return {
      ...(old ?? {}), _id: old?._id ?? new Types.ObjectId(), lineType: l.lineType, refId: new Types.ObjectId(l.ref), quantity: l.quantity, sortOrder: i,
      ...(l.unit ? { unit: l.unit } : {}), ...(l.overrideDimensions ? { overrideDimensions: l.overrideDimensions } : {}),
    };
  });
}

const org = (organizationId?: string | null) => (organizationId ? { organizationId: new Types.ObjectId(organizationId) } : {});
const dimRows = (item: PdmItemDto) => dimensionsOf(item.size).map((d) => ({ ...d, isImmutable: false }));

/** Новая запись: имя = обозначение, `needsName` (название впишет менеджер). Артикул материалов, `sku` материалов — не заполняем. */
export function newMaterial(item: PdmItemDto, id: Types.ObjectId, lines: PlannedLine[], organizationId?: string | null): Record<string, unknown> {
  const base = { _id: id, name: item.designation, article: item.designation, unit: 'шт', materialKind: item.kind, needsName: true, ...org(organizationId) };
  if (item.kind === 'part') {
    return {
      // weightUnit 'kg': без пометки приложение читает weightKg как граммы (stock/weight.ts weightGOf)
      ...base, dimensions: dimRows(item), ...(item.massKg ? { weightKg: item.massKg, weightUnit: 'kg' } : {}), ...(item.ral?.length ? { colors: item.ral } : {}),
      composition: storedLines(lines), ...(item.file ? { pdm: pdmMeta(item) } : {}), ...(lines.length && item.blank?.source ? { dimSource: item.blank.source } : {}),
    };
  }
  const aliases = [...new Set(item.aliases ?? [])].filter((a) => a !== item.designation);
  const assortment = String(item.vars?.['Сортамент'] ?? '').trim(), material = String(item.vars?.['Материал'] ?? '').trim();
  return { ...base, pdmCode: item.designation, ...(aliases.length ? { pdmAliases: aliases } : {}), ...(assortment ? { assortment } : {}), ...(material ? { materialGrade: material } : {}) };
}

/** Сортамент — сырьё без формата: склад и снабжение его не показывают; название собирается из карточки PDM. */
export function newSortament(r: PlanRaw, id: Types.ObjectId, organizationId?: string | null): Record<string, unknown> {
  return {
    _id: id, name: r.name, article: `Сортамент: ${r.name}`, unit: r.unit, materialKind: 'raw', isProfile: true, scrapFactor: 1,
    assortment: r.assortment, ...(r.material ? { materialGrade: r.material } : {}), ...org(organizationId),
  };
}

export function newModule(item: PdmItemDto, id: Types.ObjectId, lines: PlannedLine[], organizationId?: string | null): Record<string, unknown> {
  return { _id: id, name: item.designation, article: item.designation, needsName: true, composition: storedLines(lines), ...(item.file ? { pdm: pdmMeta(item) } : {}), ...org(organizationId) };
}

export function newProduct(item: PdmItemDto, id: Types.ObjectId, lines: PlannedLine[], organizationId?: string | null): Record<string, unknown> {
  return { _id: id, name: item.designation, sku: item.designation, kind: 'good', unit: 'шт', needsName: true, composition: storedLines(lines), ...(item.file ? { pdm: pdmMeta(item) } : {}), ...org(organizationId) };
}

/** Какие поля брать из PDM: пустые на сайте (`fill`) и расхождения, по которым человек выбрал PDM. */
export function takeFields(fill: string[] | undefined, conflicts: FieldConflict[], decision?: PdmDecision): Set<string> {
  const take = new Set(fill ?? []);
  if (decision?.action === 'update-all') for (const c of conflicts) take.add(c.field);
  for (const [f, v] of Object.entries(decision?.fields ?? {})) if (v === 'pdm' && conflicts.some((c) => c.field === f)) take.add(f);
  return take;
}

export interface UpdateInput {
  item: PdmItemDto;
  existing: SiteDoc;
  take: Set<string>;
  lines: PlannedLine[];
  /** Решение «артикул/sku — из PDM». */
  renameToPdm: boolean;
}

/** Правка существующей детали / модуля / изделия или `null`, если менять нечего. Лишнего не трогаем: имя, цены, фото остаются. */
export function updateOf({ item, existing, take, lines, renameToPdm }: UpdateInput): Record<string, unknown> | null {
  const set: Record<string, unknown> = {};
  const changed = !!existing.deletedAt || take.size > 0 || renameToPdm || (item.file?.version != null && (existing.pdm?.version !== item.file.version || existing.pdm?.state !== item.file.state));
  if (!changed) return null;
  if (item.file) set.pdm = pdmMeta(item);
  if (existing.deletedAt) set.deletedAt = null;
  if (renameToPdm) set[item.kind === 'product' ? 'sku' : 'article'] = item.designation;
  if (take.has('composition')) set.composition = storedLines(lines, existing.composition);
  if (item.kind === 'part') {
    if (take.has('dimensions')) set.dimensions = dimRows(item);
    if (take.has('weightKg') && item.massKg) { set.weightKg = item.massKg; set.weightUnit = 'kg'; }
    if (take.has('colors')) set.colors = item.ral;
    if (take.has('composition') && lines.length && item.blank?.source) set.dimSource = item.blank.source;
  }
  return set;
}

/** Метиз/покупное на сайте: article не меняем, добавляем только pdmCode и другие написания. `null` — всё уже записано. */
export function fastenerPatch(existing: SiteDoc, item: PdmItemDto): { set: Record<string, unknown>; add: string[] } | null {
  const set: Record<string, unknown> = {};
  const code = existing.pdmCode || item.designation;
  if (!existing.pdmCode) set.pdmCode = code;
  if (existing.deletedAt) set.deletedAt = null;
  const have = new Set(existing.pdmAliases ?? []);
  const add = [...new Set([item.designation, ...(item.aliases ?? [])])].filter((a) => a !== code && !have.has(a));
  return Object.keys(set).length || add.length ? { set, add } : null;
}

/** Разбор решений человека из тела запроса: словарь «обозначение → решение». */
export function parseDecisions(raw: unknown): Map<string, PdmDecision> {
  const out = new Map<string, PdmDecision>();
  if (raw == null) return out;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Решения должны быть словарём «обозначение → решение»');
  for (const [designation, v] of Object.entries(raw as Record<string, unknown>)) {
    const d = v as Partial<PdmDecision> | null;
    if (!d || typeof d !== 'object' || !['create', 'link', 'update-all', 'keep-site'].includes(String(d.action))) throw new BadRequestException(`Решение по «${designation}»: действие должно быть create, link, update-all или keep-site`);
    if (d.targetId != null && !Types.ObjectId.isValid(String(d.targetId))) throw new BadRequestException(`Решение по «${designation}»: некорректный targetId`);
    if (d.fields != null) {
      if (typeof d.fields !== 'object' || Array.isArray(d.fields) || Object.values(d.fields).some((x) => x !== 'site' && x !== 'pdm')) throw new BadRequestException(`Решение по «${designation}»: у поля можно указать только site или pdm`);
    }
    out.set(designation, { action: d.action as PdmDecision['action'], ...(d.targetId ? { targetId: String(d.targetId) } : {}), ...(d.fields ? { fields: d.fields } : {}) });
  }
  return out;
}
