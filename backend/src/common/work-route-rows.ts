import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * Состав работ изделия и позиции заказа (C041 Э1): части изделия + шаги (вид работ × часть).
 * Одни и те же правила для `products.parts/workTypes` и для плана позиции `orderlineplans` — чистые функции, без базы.
 */

/** Часть изделия: стойки, навес, наполнение… */
export interface PartRow {
  _id: Types.ObjectId;
  /** Запись справочника `productParts`; нет — часть введена вручную. */
  partId?: Types.ObjectId;
  name: string;
  qty: number;
  /** Строка состава изделия (composition[]._id) — только ссылка. */
  lineId?: Types.ObjectId;
  checked: boolean;
  checkedBy?: Types.ObjectId;
  checkedAt?: Date;
}

/** Шаг: вид работ для части (нет части — «Изделие целиком»). Порядок массива = порядок работ. */
export interface StepRow {
  _id: Types.ObjectId;
  workTypeId: Types.ObjectId;
  partRowId?: Types.ObjectId;
  /** Норма часов на 1 шт. */
  hours?: number;
  lineId?: Types.ObjectId;
  note?: string;
  checked: boolean;
  checkedBy?: Types.ObjectId;
  checkedAt?: Date;
  /** Задел Э2: исполнитель шага и ручной план для Ганта. */
  assigneeId?: Types.ObjectId;
  plan?: { start: Date; days: number };
}

/** Что присылает клиент. `id` — прежний id строки либо временный ключ новой. */
export interface PartIn { id?: string; partId?: string; name?: string; qty?: number; checked?: boolean; lineId?: string }
export interface StepIn { id?: string; workTypeId: string; partRowId?: string | null; hours?: number; lineId?: string; note?: string; checked?: boolean; assigneeId?: string; plan?: { start: string; days: number } }

export const WHOLE_PRODUCT = 'Изделие целиком';
export const MAX_PARTS = 50;
export const MAX_STEPS = 100;

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v);
const pairKey = (workTypeId: unknown, partRowId: unknown) => `${String(workTypeId)}|${partRowId ? String(partRowId) : ''}`;

/** Ключ шага «вид работ × часть» — по нему шаги не повторяются. */
export const stepKey = (s: Pick<StepRow, 'workTypeId' | 'partRowId'>) => pairKey(s.workTypeId, s.partRowId);

interface Ctx { typeNames: Map<string, string>; by?: Types.ObjectId; now: Date; /** Ссылки на состав и план шага берутся из прежней строки (план позиции), а не от клиента. */ keepLinks: boolean }

/** Отметка «Проверено»: прежняя сохраняется, новая ставит автора и время, снятая — убирает. */
function mark<T extends { checked: boolean; checkedBy?: Types.ObjectId; checkedAt?: Date }>(row: T, was: T | undefined, checked: boolean | undefined, ctx: Ctx): T {
  if (!checked) { delete row.checkedBy; delete row.checkedAt; return { ...row, checked: false }; }
  if (was?.checked) return { ...row, checked: true, ...(was.checkedBy ? { checkedBy: was.checkedBy } : {}), ...(was.checkedAt ? { checkedAt: was.checkedAt } : {}) };
  return { ...row, checked: true, ...(ctx.by ? { checkedBy: ctx.by } : {}), checkedAt: ctx.now };
}

/**
 * Проверка и сборка частей и шагов из присланного клиентом. Новые строки получают id; шаги ссылаются на части
 * по id или по временному ключу новой части. Повтор вида работ на одной части — 400.
 */
export function normalizeRows(input: { parts: PartIn[]; steps: StepIn[] }, prev: { parts: PartRow[]; steps: StepRow[] }, ctx: Ctx): { parts: PartRow[]; steps: StepRow[] } {
  if (input.parts.length > MAX_PARTS) throw new BadRequestException(`Частей не больше ${MAX_PARTS}`);
  if (input.steps.length > MAX_STEPS) throw new BadRequestException(`Работ не больше ${MAX_STEPS}`);
  const prevPart = new Map(prev.parts.map((p) => [String(p._id), p]));
  const keyOf = new Map<string, Types.ObjectId>(); // присланный id/временный ключ → id строки
  const names = new Set<string>();
  const parts = input.parts.map((p): PartRow => {
    const name = String(p.name ?? '').trim();
    if (!name) throw new BadRequestException('У части должно быть название');
    if (name.length > 120) throw new BadRequestException('Название части не длиннее 120 знаков');
    const low = name.toLowerCase();
    if (names.has(low)) throw new BadRequestException(`Часть «${name}» уже есть`);
    names.add(low);
    const qty = p.qty === undefined ? 1 : Number(p.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100000) throw new BadRequestException(`Количество части «${name}» — число больше нуля`);
    const was = p.id ? prevPart.get(p.id) : undefined;
    const _id = was ? was._id : isId(p.id) ? new Types.ObjectId(p.id) : new Types.ObjectId();
    if (p.id) keyOf.set(p.id, _id);
    const lineId = ctx.keepLinks ? was?.lineId : isId(p.lineId) ? new Types.ObjectId(p.lineId) : undefined;
    const row: PartRow = { _id, name, qty, checked: false, ...(isId(p.partId) ? { partId: new Types.ObjectId(p.partId) } : {}), ...(lineId ? { lineId } : {}) };
    return mark(row, was, p.checked, ctx);
  });
  const partIds = new Set(parts.map((p) => String(p._id)));
  const partName = new Map(parts.map((p) => [String(p._id), p.name]));
  const prevStep = new Map(prev.steps.map((s) => [String(s._id), s]));
  const prevByPair = new Map(prev.steps.map((s) => [stepKey(s), s]));
  const seen = new Set<string>();
  const steps = input.steps.map((s): StepRow => {
    if (!isId(s.workTypeId) || !ctx.typeNames.has(s.workTypeId)) throw new BadRequestException('Вид работ не найден — выберите из справочника');
    const workTypeId = new Types.ObjectId(s.workTypeId);
    let partRowId: Types.ObjectId | undefined;
    if (s.partRowId) {
      partRowId = keyOf.get(s.partRowId) ?? (partIds.has(s.partRowId) ? new Types.ObjectId(s.partRowId) : undefined);
      if (!partRowId) throw new BadRequestException('Часть для работы не найдена в списке частей');
    }
    const key = pairKey(workTypeId, partRowId);
    if (seen.has(key)) throw new BadRequestException(`Вид работ «${ctx.typeNames.get(s.workTypeId)}» для части «${partRowId ? partName.get(String(partRowId)) : WHOLE_PRODUCT}» уже есть`);
    seen.add(key);
    const hours = s.hours === undefined || s.hours === null ? undefined : Number(s.hours);
    if (hours !== undefined && (!Number.isFinite(hours) || hours < 0 || hours > 1000)) throw new BadRequestException('Норма часов — число от 0 до 1000');
    const was = (s.id && prevStep.get(s.id)) || prevByPair.get(key);
    const note = s.note?.trim();
    const lineId = ctx.keepLinks ? was?.lineId : isId(s.lineId) ? new Types.ObjectId(s.lineId) : undefined;
    const assigneeId = s.assigneeId !== undefined ? (isId(s.assigneeId) ? new Types.ObjectId(s.assigneeId) : undefined) : ctx.keepLinks ? was?.assigneeId : undefined;
    const plan = s.plan !== undefined
      ? (s.plan && !Number.isNaN(Date.parse(s.plan.start)) && s.plan.days >= 1 && s.plan.days <= 365 ? { start: new Date(s.plan.start), days: Math.floor(s.plan.days) } : undefined)
      : ctx.keepLinks ? was?.plan : undefined;
    const row: StepRow = {
      _id: was ? was._id : isId(s.id) ? new Types.ObjectId(s.id) : new Types.ObjectId(), workTypeId, checked: false,
      ...(partRowId ? { partRowId } : {}), ...(hours !== undefined ? { hours } : {}), ...(lineId ? { lineId } : {}), ...(note ? { note } : {}),
      ...(assigneeId ? { assigneeId } : {}), ...(plan ? { plan } : {}),
    };
    return mark(row, was, s.checked, ctx);
  });
  return { parts, steps };
}

/** Поставить или снять «Проверено» у одной строки. Нет строки — null. */
export function setChecked<T extends { _id: Types.ObjectId; checked: boolean; checkedBy?: Types.ObjectId; checkedAt?: Date }>(rows: T[], rowId: string, checked: boolean, ctx: Pick<Ctx, 'by' | 'now'>): T[] | null {
  const at = rows.findIndex((r) => String(r._id) === rowId);
  if (at < 0) return null;
  const next = [...rows];
  const { checkedBy, checkedAt, ...rest } = rows[at]; // eslint-disable-line @typescript-eslint/no-unused-vars
  next[at] = checked ? { ...rest, checked: true, ...(ctx.by ? { checkedBy: ctx.by } : {}), checkedAt: ctx.now } as T : { ...rest, checked: false } as T;
  return next;
}

/** Части и шаги из изделия (`products.parts/workTypes`). Шаги получают новые id; удалённые виды работ и «осиротевшие» ссылки на части пропускаются. */
export function rowsFromProduct(p: Record<string, unknown>, typeNames: Map<string, string>): { parts: PartRow[]; steps: StepRow[] } {
  const parts = ((p.parts as PartRow[] | undefined) ?? []).map((x): PartRow => ({
    _id: x._id, name: x.name, qty: x.qty ?? 1, checked: !!x.checked,
    ...(x.partId ? { partId: x.partId } : {}), ...(x.lineId ? { lineId: x.lineId } : {}), ...(x.checkedBy ? { checkedBy: x.checkedBy } : {}), ...(x.checkedAt ? { checkedAt: x.checkedAt } : {}),
  }));
  const have = new Set(parts.map((x) => String(x._id)));
  const steps = ((p.workTypes as Array<Partial<StepRow>> | undefined) ?? []).filter((w) => w.workTypeId && typeNames.has(String(w.workTypeId))).map((w): StepRow => ({
    _id: new Types.ObjectId(), workTypeId: w.workTypeId!, checked: !!w.checked,
    ...(w.partRowId && have.has(String(w.partRowId)) ? { partRowId: w.partRowId } : {}), ...(w.hours !== undefined ? { hours: w.hours } : {}),
    ...(w.lineId ? { lineId: w.lineId } : {}), ...(w.note ? { note: w.note } : {}), ...(w.checkedBy ? { checkedBy: w.checkedBy } : {}), ...(w.checkedAt ? { checkedAt: w.checkedAt } : {}),
  }));
  return { parts, steps };
}

/** Поля для записи в изделие: `parts` и `workTypes` (пустое — убрать поле). */
export function productFields(parts: PartRow[], steps: StepRow[]): { set: Record<string, unknown>; unset: Record<string, ''> } {
  const set: Record<string, unknown> = {}, unset: Record<string, ''> = {};
  if (parts.length) set.parts = parts.map(({ _id, partId, name, qty, lineId, checked, checkedBy, checkedAt }) => ({ _id, name, qty, checked, ...(partId ? { partId } : {}), ...(lineId ? { lineId } : {}), ...(checkedBy ? { checkedBy } : {}), ...(checkedAt ? { checkedAt } : {}) }));
  else unset.parts = '';
  if (steps.length) set.workTypes = steps.map(({ workTypeId, partRowId, hours, lineId, note, checked, checkedBy, checkedAt }) => ({ workTypeId, checked, ...(partRowId ? { partRowId } : {}), ...(hours !== undefined ? { hours } : {}), ...(lineId ? { lineId } : {}), ...(note ? { note } : {}), ...(checkedBy ? { checkedBy } : {}), ...(checkedAt ? { checkedAt } : {}) }));
  else unset.workTypes = '';
  return { set, unset };
}

export interface PlanDiff { changed: boolean; added: number; removed: number; edited: number }

/**
 * Чем план отличается от изделия: добавлено / убрано / изменено (количество, название, часы, порядок работ).
 * «Проверено» в сравнение не входит — галочка сама по себе не повод спрашивать «и в продукцию?».
 */
export function diffRows(plan: { parts: PartRow[]; steps: StepRow[] }, base: { parts: PartRow[]; steps: StepRow[] }): PlanDiff {
  let added = 0, removed = 0, edited = 0;
  const cmp = <T>(a: T[], b: T[], key: (x: T) => string, same: (x: T, y: T) => boolean) => {
    const bm = new Map(b.map((x) => [key(x), x]));
    const am = new Map(a.map((x) => [key(x), x]));
    for (const [k, x] of am) { const y = bm.get(k); if (!y) added++; else if (!same(x, y)) edited++; }
    for (const k of bm.keys()) if (!am.has(k)) removed++;
  };
  cmp(plan.parts, base.parts, (x) => String(x._id), (x, y) => x.name === y.name && x.qty === y.qty);
  // шаги сравниваются по «виду работ × часть»; часть — по id (в плане и изделии они общие)
  cmp(plan.steps, base.steps, stepKey, (x, y) => (x.hours ?? 0) === (y.hours ?? 0) && (x.note ?? '') === (y.note ?? ''));
  if (!added && !removed && !edited && plan.steps.map(stepKey).join() !== base.steps.map(stepKey).join()) edited = 1; // только порядок
  return { changed: added + removed + edited > 0, added, removed, edited };
}
