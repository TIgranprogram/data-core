import { NotFoundException } from '@nestjs/common';
import { Types, type mongo } from 'mongoose';

/** Что не хватает техописанию (C114 D-S, D-REPORT п.4 №11). Только пустое; ключи полей изделия — как в очереди заполнения. */
export interface TechGap { key: string; label: string; required: boolean; weight: number; opens: string }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const str = (v: unknown) => String(v ?? '').trim();

/** Пункты, которых нет среди пробелов паспорта и полей изделия очереди: в `fill-queue` идут только они. */
export const TECH_ONLY_KEYS = ['materials', 'parts'];

/** Чистая функция: изделие (materialsSpec, dimensions, weightKg, purpose, installation) → пустые пункты техописания. */
export function techSheetGaps(p: Record<string, unknown>): TechGap[] {
  const out: TechGap[] = [];
  const rows = ((p.materialsSpec as { rows?: Array<{ partIds?: unknown[] }> } | undefined)?.rows ?? []);
  if (!rows.length) out.push({ key: 'materials', label: 'Материалы изделия', required: true, weight: 4, opens: 'без них техописание не собрать' });
  else if (rows.some((r) => !(r.partIds ?? []).length)) out.push({ key: 'parts', label: 'Части у материалов (стойка, перекладина…)', required: false, weight: 3, opens: 'в техописании вместо «Материал» будет название части' });
  const d = (p.dimensions ?? {}) as Record<string, unknown>;
  if (!num(d.length) || !num(d.width) || !num(d.height)) out.push({ key: 'dimensions', label: 'Габариты', required: false, weight: 3, opens: 'строки «Длина / Ширина / Высота» в техописании' });
  if (!num(p.weightKg)) out.push({ key: 'weightKg', label: 'Вес', required: false, weight: 3, opens: 'строка «Вес» в техописании' });
  if (!str(p.purpose)) out.push({ key: 'purpose', label: 'Назначение', required: false, weight: 2, opens: 'строка «Назначение» в техописании' });
  if (!str(p.installationMethod) && !str(p.installation)) out.push({ key: 'installation', label: 'Монтаж', required: false, weight: 2, opens: 'строка «Установка» в техописании' });
  return out;
}

/** Поля изделия, нужные расчёту пробелов техописания. */
export const TECH_PROJECTION = { materialsSpec: 1, dimensions: 1, weightKg: 1, purpose: 1, installation: 1, installationMethod: 1 };

/** GET showcase/:id/techsheet-gaps → { ready, missing[] }. Нет изделия — 404. */
export async function productTechGaps(db: mongo.Db, productId: string) {
  if (!Types.ObjectId.isValid(productId)) throw new NotFoundException(`Изделие ${productId} не найдено`);
  const p = await db.collection('products').findOne({ _id: new Types.ObjectId(productId), deletedAt: null }, { projection: TECH_PROJECTION });
  if (!p) throw new NotFoundException(`Изделие ${productId} не найдено`);
  const missing = techSheetGaps(p);
  return { ready: !missing.length, missing };
}
