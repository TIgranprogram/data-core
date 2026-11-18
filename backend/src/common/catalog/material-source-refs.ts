import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

export type SourceKind = 'module' | 'part' | 'purchased' | 'product' | 'fastener' | 'raw' | 'material';
export type SourceStep = { kind: SourceKind; refId: string; name: string; code: string; lineId?: string };
export type SourceRef = SourceStep & { path: SourceStep[] };
const kinds: SourceKind[] = ['module', 'part', 'purchased', 'product', 'fastener', 'raw', 'material'];
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Метаданные описания: строки id, без новых ссылок и изменений производственных коллекций. */
export function parseSourceRefs(value: unknown): SourceRef[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > 100) throw new BadRequestException('Источники: список до 100 записей');
  const step = (raw: unknown): SourceStep => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Источник — объект');
    const r = raw as Record<string, unknown>;
    if (!kinds.includes(r.kind as SourceKind) || !Types.ObjectId.isValid(clean(r.refId))) throw new BadRequestException('Некорректный тип или ссылка источника');
    if (typeof r.name !== 'string' || r.name.length > 300 || (r.code != null && (typeof r.code !== 'string' || r.code.length > 120))) throw new BadRequestException('Имя источника — до 300, обозначение — до 120 знаков');
    if (r.lineId != null && !Types.ObjectId.isValid(clean(r.lineId))) throw new BadRequestException('Некорректная строка источника');
    return { kind: r.kind as SourceKind, refId: clean(r.refId), name: clean(r.name), code: clean(r.code), ...(r.lineId != null ? { lineId: clean(r.lineId) } : {}) };
  };
  const refs = value.map((raw) => {
    const r = raw as Record<string, unknown>;
    const head = step(raw);
    if (!Array.isArray(r.path) || !r.path.length || r.path.length > 10) throw new BadRequestException('Путь источника: от 1 до 10 ссылок');
    return { ...head, path: r.path.map(step) };
  });
  return [...new Map(refs.map((r) => [JSON.stringify(r), r])).values()];
}
