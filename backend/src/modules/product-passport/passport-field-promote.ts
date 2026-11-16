import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Types, type mongo } from 'mongoose';
import { MAX_OVERRIDE_TEXT } from '../../common/passport/text-overrides';
import type { FieldRef } from './passport-snapshot-field';

export interface PromoteResult { ok: true; target: string; kind: FieldRef['kind']; affected: number; shared: boolean }
const DICT = { element: 'passportElements', defect: 'passportDefects', install: 'passportInstall', material: 'passportMaterials' } as const;
const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const oid = (v: string) => { if (!Types.ObjectId.isValid(v)) throw new BadRequestException('Некорректная ссылка на источник'); return new Types.ObjectId(v); };
export const sourceToken = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const conflict = () => new ConflictException('Источник изменился или неоднозначен. Откройте редактор заново и проверьте источник.');

export function replaceLine(raw: unknown, old: string, text: string): string | string[] | null {
  const arr = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/\r?\n/) : [];
  const hits = arr.map((l, i) => norm(l) === norm(old) ? i : -1).filter((i) => i >= 0);
  if (hits.length !== 1) return null;
  const next = arr.map((l, i) => i === hits[0] ? text : l);
  return Array.isArray(raw) ? next : next.join('\n');
}

/** Единый план чтения и CAS: чужие поля не перезаписываются. */
async function plan(db: mongo.Db, ref: FieldRef, productId: string, count = true) {
  const product = ref.kind === 'product' || ref.kind === 'funnel';
  const coll = db.collection(product ? 'products' : 'dict_values');
  const _id = oid(ref.kind === 'funnel' ? productId : ref.id);
  const dict = DICT[ref.kind as keyof typeof DICT];
  const rec = await coll.findOne({ _id, deletedAt: null, ...(!product ? { dict } : {}) });
  if (!rec) throw conflict();
  const key = ({ description: 'description', purpose: 'purpose', installation: 'installationMethod' } as Record<string, string>)[ref.field];
  if (ref.kind === 'product' && !key) throw new BadRequestException('Это поле изделия не хранит текст паспорта');
  const path = ref.kind === 'funnel' ? `passportDefaults.textOverrides.${oid(ref.id).toHexString()}` : ref.field;
  const raw = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], rec);
  let affected = 1;
  if (!product && count) {
    let choices: Record<string, unknown>[];
    if (ref.kind === 'defect') {
      const codes = (Array.isArray(rec.applies) ? rec.applies : String(rec.applies ?? '').split(/[,;]/)).map(norm).filter(Boolean);
      const owners = await db.collection('dict_values').find({ dict: { $in: ['passportElements', 'passportMaterials'] }, code: { $in: codes }, deletedAt: null }).toArray();
      choices = ['passportElements', 'passportMaterials'].map((d, i) => ({ [`passportDefaults.${i ? 'materialIds' : 'elements'}`]: { $in: owners.filter((o) => o.dict === d).map((o) => o._id) } }));
    } else {
      const field = ref.kind === 'element' ? 'elements' : ref.kind === 'material' ? 'materialIds' : 'installationTypeId';
      choices = [{ [`passportDefaults.${field}`]: { $in: [_id] } }];
    }
    affected = await db.collection('products').countDocuments({ deletedAt: null, $or: choices });
  }
  const target = product ? `изделие «${norm(rec.name) || norm(rec.sku)}»` : `справочник: ${{ element: 'элемент', defect: 'дефект', install: 'способ установки', material: 'материал' }[ref.kind as 'element']} «${norm(rec.name) || norm(rec.code)}»`;
  return { coll, rec, path, raw, key, result: { ok: true as const, target, kind: ref.kind, affected, shared: affected > 1 }, token: sourceToken([ref, productId, raw ?? null]) };
}
export async function fieldSourceName(db: mongo.Db, ref: FieldRef, productId: string) {
  return (await plan(db, ref, productId, false)).result.target;
}
export async function fieldDestination(db: mongo.Db, ref: FieldRef, productId: string, old?: string) {
  const p = await plan(db, ref, productId);
  if (old !== undefined && ref.kind in DICT) {
    const moves = (p.rec.passportTextMoves ?? {}) as Record<string, string>;
    const current = moves[ref.field + '_' + sourceToken(norm(old))] ?? old;
    if (ref.kind === 'element' ? replaceLine(p.raw, current, current) === null : norm(p.raw) !== norm(current)) throw conflict();
  }
  return { ...p.result, token: p.token };
}
export async function promoteField(db: mongo.Db, ref: FieldRef, text: string, old: string, productId: string, token?: string): Promise<PromoteResult> {
  const p = await plan(db, ref, productId);
  if (token !== undefined && token !== p.token) throw conflict();
  if (ref.kind === 'funnel' && text.length > MAX_OVERRIDE_TEXT) throw new BadRequestException(`Текст длиннее ${MAX_OVERRIDE_TEXT} знаков`);
  const moveKey = ref.field + '_' + sourceToken(norm(old));
  const moves = (p.rec.passportTextMoves ?? {}) as Record<string, string>;
  let value: unknown = text;
  if (ref.kind === 'element') {
    value = replaceLine(p.raw, token && moves[moveKey] ? moves[moveKey] : old, text) ?? replaceLine(p.raw, text, text);
    if (value === null) throw conflict();
  } else if ((ref.kind in DICT || (!token && ref.kind !== 'funnel')) && norm(p.raw) !== norm(token && moves[moveKey] ? moves[moveKey] : old) && norm(p.raw) !== norm(text)) throw conflict();
  if (ref.kind === 'funnel') {
    if (!token && p.raw && norm((p.raw as { text?: string }).text) !== norm(old) && norm((p.raw as { text?: string }).text) !== norm(text)) throw conflict();
    value = { text };
  }
  // null passportDefaults требует инициализации под CAS; обычные документы обновляются точечно.
  const nullDefaults = (ref.kind === 'product' || ref.kind === 'funnel') && p.rec.passportDefaults === null;
  const set: Record<string, unknown> = { [p.path]: value, updatedAt: new Date() };
  if (ref.kind in DICT) {
    if (!moves[moveKey] && Object.keys(moves).length >= 500) throw new ConflictException('Для этой записи накоплено много переносов. Откройте справочник для изменения текста');
    // Цепочка переносов позволяет старому паспорту повторить сохранение без изменения снимка.
    const previous = token && moves[moveKey] ? moves[moveKey] : old;
    for (const [key, moved] of Object.entries(moves)) if (key.startsWith(ref.field + '_') && norm(moved) === norm(previous)) set['passportTextMoves.' + key] = text;
    set['passportTextMoves.' + moveKey] = text;
  }
  if (nullDefaults) {
    delete set[p.path];
    set.passportDefaults = ref.kind === 'funnel' ? { textOverrides: { [ref.id]: value } } : { manualText: [p.key] };
    if (ref.kind === 'product') set[p.path] = value;
  }
  const r = await p.coll.updateOne({ _id: p.rec._id, deletedAt: null, [p.path]: p.raw === undefined ? { $exists: false } : p.raw, ...(nullDefaults ? { passportDefaults: null } : {}) }, { $set: set, ...(ref.kind === 'product' && !nullDefaults ? { $addToSet: { 'passportDefaults.manualText': p.key } } : {}) });
  if (r.matchedCount !== 1) throw conflict();
  return p.result;
}
