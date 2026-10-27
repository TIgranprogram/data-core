import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { oid } from '../list-query';
import { normSize } from './materials-text';

/**
 * МЦ-2/МЦ-6: `materials.passportSpec` — связь позиции склада с материалом паспорта (поле только data-core, CRM не читает):
 * { materialId → dict_values passportMaterials, sizes[] (без «мм», normSize), isCoating, passportText, techText }.
 * Тексты (МЦ-6) — в том же поддереве, но в списки материалов не отдаются (см. `listPassportSpec`).
 */
export type StoredPassportSpec = { materialId?: Types.ObjectId; sizes?: string[]; isCoating?: boolean; passportText?: string; techText?: string };
export type PassportSpecView = { materialId?: string; sizes?: string[]; isCoating?: boolean; passportText?: string; techText?: string };

const MAX_SIZES = 20, MAX_TEXT = 2000;
const text = (v: unknown, what: string): string | undefined => {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== 'string') throw new BadRequestException(`${what} — строка`);
  const t = v.replace(/\r\n/g, '\n').trim();
  if (t.length > MAX_TEXT) throw new BadRequestException(`${what}: не больше ${MAX_TEXT} знаков`);
  return t || undefined;
};

/**
 * Тело PATCH поверх текущей записи: переданные ключи заменяют, не переданные остаются. `materialId: null` снимает связь
 * (вместе с размерами и признаком покрытия), пустой текст — снимает текст. Ничего не осталось — null (поле убрать совсем).
 */
export function mergePassportSpec(current: StoredPassportSpec | null | undefined, body: unknown): StoredPassportSpec | null {
  if (body === null || body === undefined || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Тело запроса — объект { materialId, sizes, isCoating }');
  const b = body as Record<string, unknown>;
  const out: StoredPassportSpec = { ...(current ?? {}) };
  if ('materialId' in b) {
    if (b.materialId === null || b.materialId === '') { delete out.materialId; delete out.sizes; delete out.isCoating; }
    else out.materialId = oid(b.materialId, 'материала паспорта');
  }
  if ('sizes' in b && b.sizes !== null) {
    if (!Array.isArray(b.sizes)) throw new BadRequestException('sizes — список размеров');
    const sizes = [...new Set(b.sizes.map(normSize).filter(Boolean))];
    if (sizes.length > MAX_SIZES) throw new BadRequestException(`Размеров не больше ${MAX_SIZES}`);
    if (sizes.some((z) => z.length > 40)) throw new BadRequestException('Размер длиннее 40 знаков');
    if (sizes.length) out.sizes = sizes; else delete out.sizes;
  } else if (b.sizes === null) delete out.sizes;
  if ('isCoating' in b) {
    if (b.isCoating !== null && typeof b.isCoating !== 'boolean') throw new BadRequestException('isCoating — да/нет');
    if (b.isCoating) out.isCoating = true; else delete out.isCoating;
  }
  for (const k of ['passportText', 'techText'] as const) {
    if (!(k in b)) continue;
    const t = text(b[k], k === 'passportText' ? 'Текст паспорта' : 'Технический текст');
    if (t) out[k] = t; else delete out[k];
  }
  if (!out.materialId && (out.sizes || out.isCoating)) throw new BadRequestException('Размеры и признак покрытия — только вместе с материалом паспорта');
  return out.materialId || out.sizes || out.isCoating || out.passportText || out.techText ? out : null;
}

/** Запись → ответ API (id строкой). `withTexts: false` — для списков (тексты МЦ-6 не отдаются). */
export function presentPassportSpec(v: unknown, withTexts = true): PassportSpecView | null {
  const sp = v as StoredPassportSpec | null | undefined;
  if (!sp || typeof sp !== 'object') return null;
  const out: PassportSpecView = {};
  if (sp.materialId) out.materialId = String(sp.materialId);
  if (sp.sizes?.length) out.sizes = sp.sizes.map(String);
  if (sp.isCoating) out.isCoating = true;
  if (withTexts) { if (sp.passportText) out.passportText = sp.passportText; if (sp.techText) out.techText = sp.techText; }
  return Object.keys(out).length ? out : null;
}
