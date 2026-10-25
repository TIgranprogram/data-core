import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { parseChoices } from '../../common/passport/phrase-tree';

/**
 * Значения паспорта по умолчанию у изделия каталога (БЗ-6 Э4b): `products.passportDefaults` — только новое поле
 * (коллекция общая с kppdf). «Выпустить паспорт» подставляет их в новый паспорт; запасной путь — последний паспорт модели.
 */
export const PASSPORT_CATEGORY_CODES = ['DIO', 'DSP', 'TRN', 'WRK', 'BLG'] as const;
const NUMS = ['ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth', 'serviceLifeYears', 'warrantyMonths'] as const;

export interface PassportDefaults {
  passportCategory?: string; elements?: Types.ObjectId[]; materialIds?: Types.ObjectId[]; installationTypeId?: Types.ObjectId | null; isKit?: boolean;
  /** ПВ: выбор текстов воронкой { id раздела: id конечного варианта } (справочник «Тексты паспорта»). */
  textChoices?: Record<string, string>;
  [k: string]: unknown;
}

const oidOf = (v: unknown, what: string) => {
  if (!Types.ObjectId.isValid(String(v ?? ''))) throw new BadRequestException(`Некорректная ссылка: ${what}`);
  return new Types.ObjectId(String(v));
};

/** Тело запроса → значения для записи; пустые поля не сохраняются, неизвестные — отбрасываются. */
export function normalizePassportDefaults(b: Record<string, unknown>): PassportDefaults {
  const out: PassportDefaults = {};
  const raw = String(b.passportCategory ?? '').trim();
  const cat = raw === 'MAF' ? 'BLG' : raw; // старый код (2026-10-25: MAF → BLG)
  if (cat) {
    if (!(PASSPORT_CATEGORY_CODES as readonly string[]).includes(cat)) throw new BadRequestException(`Категория паспорта: одна из ${PASSPORT_CATEGORY_CODES.join(', ')}`);
    out.passportCategory = cat;
  }
  for (const k of ['elements', 'materialIds'] as const) {
    if (b[k] === undefined || b[k] === null) continue;
    if (!Array.isArray(b[k])) throw new BadRequestException(`${k}: список`);
    const ids = (b[k] as unknown[]).map((x) => oidOf(x, k));
    if (ids.length) out[k] = ids;
  }
  if (b.installationTypeId) out.installationTypeId = oidOf(b.installationTypeId, 'способ установки');
  if (typeof b.isKit === 'boolean') out.isKit = b.isKit;
  const tc = parseChoices(b.textChoices);
  if (tc) out.textChoices = tc;
  for (const k of NUMS) {
    const raw = b[k];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${k}: неотрицательное число`);
    out[k] = n;
  }
  return out;
}

/** Для ответа API: ObjectId → строки. */
export const presentPassportDefaults = (d: PassportDefaults | null | undefined) => (!d ? null : {
  ...d,
  ...(d.elements ? { elements: d.elements.map(String) } : {}),
  ...(d.materialIds ? { materialIds: d.materialIds.map(String) } : {}),
  ...(d.installationTypeId ? { installationTypeId: String(d.installationTypeId) } : {}),
});

/**
 * Дополнение значений по умолчанию (массовая правка): поля заменяются, а выбор текстов `textChoices` сливается по разделам —
 * иначе пакетная правка одного раздела стёрла бы чужие выборы. Пустое значение раздела снимает выбор.
 */
export function mergePassportDefaults(cur: Record<string, unknown> | null | undefined, inc: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(cur ?? {}), ...inc };
  if (cur?.textChoices || inc.textChoices) {
    const tc = Object.fromEntries(Object.entries({ ...((cur?.textChoices as Record<string, unknown>) ?? {}), ...((inc.textChoices as Record<string, unknown>) ?? {}) }).filter(([, v]) => v));
    if (Object.keys(tc).length) merged.textChoices = tc; else delete merged.textChoices;
  }
  return merged;
}
