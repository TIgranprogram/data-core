import { BadRequestException } from '@nestjs/common';
import type { mongo } from 'mongoose';
import { Types } from 'mongoose';
import { oid } from '../../common/list-query';

type Db = mongo.Db;

/** Справочник «Причины списания» (dicts, `dict_values`); значения по умолчанию — SEED_WRITE_OFF_REASONS. */
export const WRITE_OFF_DICT = 'writeOffReasons';
export const SEED_WRITE_OFF_REASONS = ['Брак', 'Потеря', 'Порча', 'Прочее'];

export interface TargetInput {
  salesOrderId?: string;
  salesOrderLineId?: string;
  personId?: string;
  issuedTo?: string;
}

/**
 * «Кому / под что» выдано (SK-5): одна проверка для движения, пакета и выдачи по брони.
 * Заказ существует и не в корзине; позиция (`incomes`) принадлежит этому заказу; одна позиция без заказа —
 * заказ берётся из позиции; сотрудник существует. Возвращает поля для записи в `stockmovements`
 * (`orderId` — тот же id строкой: списание видно и в CRM).
 */
export async function resolveTarget(db: Db, p: TargetInput): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  let orderId: Types.ObjectId | undefined = p.salesOrderId ? oid(p.salesOrderId, 'заказа') : undefined;
  if (p.salesOrderLineId) {
    const line = await db.collection('incomes').findOne({ _id: oid(p.salesOrderLineId, 'позиции заказа'), deletedAt: null }, { projection: { orderId: 1 } });
    if (!line) throw new BadRequestException('Позиция заказа не найдена — обновите страницу');
    if (!line.orderId) throw new BadRequestException('Позиция не привязана к заказу');
    if (orderId && !orderId.equals(line.orderId as Types.ObjectId)) throw new BadRequestException('Позиция относится к другому заказу — выберите позицию выбранного заказа');
    orderId = line.orderId as Types.ObjectId;
    out.salesOrderLineId = line._id;
  }
  if (orderId) {
    const so = await db.collection('salesorders').findOne({ _id: orderId, deletedAt: null }, { projection: { _id: 1 } });
    if (!so) throw new BadRequestException('Заказ не найден или в корзине — обновите страницу');
    out.salesOrderId = so._id;
    out.orderId = String(so._id);
  }
  if (p.personId) {
    const person = await db.collection('persons').findOne({ _id: oid(p.personId, 'сотрудника'), deletedAt: null }, { projection: { _id: 1 } });
    if (!person) throw new BadRequestException('Сотрудник не найден — обновите страницу');
    out.issuedToPersonId = person._id;
  }
  const text = p.issuedTo?.trim();
  if (text) out.issuedTo = text.slice(0, 200);
  return out;
}

export interface FlagsInput {
  type: string;
  /** Это списание (брак, потеря…) — тогда причина обязательна. Причина сама по себе тоже означает списание. */
  writeOff?: boolean;
  reason?: string;
  isReturn?: boolean;
  salesOrderId?: string;
  salesOrderLineId?: string;
  personId?: string;
  issuedTo?: string;
}

/**
 * Правила новых признаков движения (без базы): списание — это `out` без заказа, позиции, сотрудника и «кому»,
 * причина нужна ему (и только ему); возврат — только приход и только с позицией заказа.
 * Возвращает, нужно ли сверять причину со справочником.
 */
export function checkMoveFlags(m: FlagsInput): { writeOff: boolean; reason?: string } {
  const reason = m.reason?.trim() || undefined;
  const writeOff = !!(m.writeOff || reason);
  if (m.isReturn) {
    if (m.type !== 'in') throw new BadRequestException('Возврат — это приход: отметка «возврат» только у прихода');
    if (!m.salesOrderLineId) throw new BadRequestException('Возврат оформляется под позицию заказа — выберите позицию');
  }
  if (writeOff) {
    if (m.type !== 'out') throw new BadRequestException('Причина указывается только при списании');
    if (m.isReturn) throw new BadRequestException('Списание не может быть возвратом');
    if (m.salesOrderId || m.salesOrderLineId || m.personId || m.issuedTo?.trim()) throw new BadRequestException('Списание оформляется без заказа и сотрудника: выберите либо «выдать», либо «списать»');
    if (!reason) throw new BadRequestException('Укажите причину списания');
  }
  return { writeOff, reason };
}

/** Причина из справочника «Причины списания» (без учёта регистра); возвращает название, как оно записано в справочнике. */
export async function resolveReason(db: Db, reason: string): Promise<string> {
  const names = (await db.collection('dict_values').find({ dict: WRITE_OFF_DICT, deletedAt: null }, { projection: { name: 1 } }).toArray())
    .map((d) => String(d.name ?? '').trim()).filter(Boolean);
  const key = reason.trim().toLowerCase().replace(/ё/g, 'е');
  const hit = names.find((n) => n.toLowerCase().replace(/ё/g, 'е') === key);
  if (!hit) throw new BadRequestException(`Причины «${reason}» нет в справочнике «Причины списания» — выберите из списка${names.length ? ': ' + names.join(', ') : ''}`);
  return hit;
}

/**
 * Всё про «кому / под что» одного движения/пакета: проверки признаков, поля для записи и причина.
 * Нужно ли это типу: выдача (`out`) и возврат (`in` + isReturn). Прочие типы — как раньше, без этих полей.
 */
export async function prepareTarget(db: Db, m: FlagsInput): Promise<Record<string, unknown>> {
  const { writeOff, reason } = checkMoveFlags(m);
  const wantsTarget = m.type === 'out' || (m.type === 'in' && !!m.isReturn);
  const target = wantsTarget ? await resolveTarget(db, m) : {};
  if (writeOff && reason) target.reason = await resolveReason(db, reason);
  if (m.type === 'in' && m.isReturn) target.isReturn = true;
  return target;
}

/**
 * Позиции заказа одним запросом (спецификация): id позиции → её `lineNo`/название, если она принадлежит заказу.
 * Чужая или несуществующая позиция — в `bad` (не ошибка: строку спецификации пропускают с причиной).
 */
export async function lookupOrderLines(db: Db, orderId: Types.ObjectId, lineIds: string[]) {
  const ids = [...new Set(lineIds.filter((x) => Types.ObjectId.isValid(x)))].map((x) => new Types.ObjectId(x));
  const docs = ids.length ? await db.collection('incomes').find({ _id: { $in: ids }, deletedAt: null }, { projection: { orderId: 1, lineNo: 1, title: 1 } }).toArray() : [];
  const ok = new Map<string, { lineNo: number | null; title: string }>();
  for (const d of docs) if (d.orderId && orderId.equals(d.orderId as Types.ObjectId)) ok.set(String(d._id), { lineNo: (d.lineNo as number) ?? null, title: String(d.title ?? '') });
  return ok;
}
