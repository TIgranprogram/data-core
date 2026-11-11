import { requiredFieldsOf } from './passport-rules';

/**
 * Применимость вопросов паспорта (C086): категория + тип изделия → какие поля вообще относятся к изделию.
 * Один источник для экрана заполнения (GET /showcase/:id/passport-gaps → `applicable`) и для списка признаков.
 * Обязательность — отдельное правило (`requiredFieldsOf`, справочник категорий); применимость её не заменяет:
 * необязательное поле бывает полезным, неприменимое не спрашивается ни в каком режиме.
 * Матрица с источниками — docs/crew/C086-passports-owner-review/APPLICABILITY.md.
 */
export type Applies = 'required' | 'optional';

/** Параметры пользователя и площадки: имеют смысл только там, где изделием пользуются (игра, спорт). */
export const USER_FIELDS: readonly string[] = ['maxUsers', 'ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'fallHeight', 'siteLength', 'siteWidth'];
/** Числа любого паспорта. */
export const COMMON_FIELDS: readonly string[] = ['serviceLifeYears', 'warrantyMonths'];

/**
 * Применимо, но не обязательно — сверх обязательных полей категории. Благоустройство: параметров пользователя нет.
 * Принято по умолчанию (C086), на проверку владельцу: нормативных значений здесь нет, только «можно указать».
 */
export const OPTIONAL_FIELDS_BY_CATEGORY: Record<string, readonly string[]> = {
  DIO: ['heightMin', 'heightMax', 'weightMax'],
  DSP: ['ageTo', 'heightMin', 'heightMax', 'weightMax', 'fallHeight'],
  TRN: ['ageFrom', 'heightMax'],
  WRK: ['ageFrom', 'heightMin', 'heightMax', 'weightMax', 'fallHeight'],
  BLG: [],
};

/** Тип изделия внутри широкой категории «Благоустройство». */
export type BlgType = 'fence' | 'seating' | 'other';
export const BLG_TYPE_LABELS: Record<BlgType, string> = { fence: 'Ограждение', seating: 'Места для сидения', other: 'Прочее благоустройство' };

/** Назначение (лист раздела «Назначение») → тип. Имена — как в справочнике `passportPhrases` и `name-suggest.ts`. */
const TYPE_BY_PURPOSE: Record<string, BlgType> = {
  'Ограждение': 'fence',
  'Отдых': 'seating', 'Зрительские места': 'seating',
  'Информирование': 'other', 'Навес, беседка': 'other', 'Сбор мусора': 'other', 'Озеленение': 'other', 'Освещение': 'other', 'Прочее благоустройство': 'other',
};
/** Группа каталога → тип (данные изделия, подтверждать не нужно). Группа «Благоустройство (…невошедшее…)» тип не называет. */
const TYPE_BY_GROUP: Array<[RegExp, BlgType]> = [
  [/^огражден/i, 'fence'],
  [/^(скамь|трибун|стол)/i, 'seating'],
  [/^(информацион|урн|вазон|велопарков|навес|геопластик)/i, 'other'],
];
/** Признаки благоустройства, зависящие от типа (коды справочника `productFacets`). Неизвестный код — применим всегда. */
const FACET_TYPES: Record<string, readonly BlgType[]> = {
  'blg.fence': ['fence'],
  'blg.seats': ['seating'], 'blg.seat': ['seating'], 'blg.rail': ['seating'],
};

export interface ProductType { code: BlgType | null; label: string | null; source: 'purpose' | 'facet' | 'group' | null; known: boolean; needed: boolean }

/**
 * Тип изделия. Порядок: выбранное назначение → уже указанный признак типа → группа каталога.
 * Категории, кроме BLG, типа не требуют (`needed: false`). Подсказка по названию типом не считается, пока её не подтвердили.
 */
export function productType(code: string, src: { purposeName?: string; facetCodes?: string[]; group?: string }): ProductType {
  if (code !== 'BLG') return { code: null, label: null, source: null, known: true, needed: false };
  const hit = (t: BlgType, source: ProductType['source']): ProductType => ({ code: t, label: BLG_TYPE_LABELS[t], source, known: true, needed: true });
  const byPurpose = TYPE_BY_PURPOSE[String(src.purposeName ?? '').trim()];
  if (byPurpose) return hit(byPurpose, 'purpose');
  for (const fc of src.facetCodes ?? []) {
    const types = FACET_TYPES[fc];
    if (types?.length === 1) return hit(types[0], 'facet');
  }
  const g = String(src.group ?? '').trim();
  for (const [re, t] of TYPE_BY_GROUP) if (re.test(g)) return hit(t, 'group');
  return { code: null, label: null, source: null, known: false, needed: true };
}

/** Признак относится к изделию? Тип неизвестен — зависящие от типа признаки не спрашиваем (сначала уточнение типа). */
export function facetApplies(facetCode: string, type: ProductType): boolean {
  const types = FACET_TYPES[facetCode];
  if (!types) return true;
  return !!type.code && types.includes(type.code);
}

export interface Applicability {
  /** Числа паспорта: ключ → обязательно / необязательно. Ключа нет — поле к изделию не относится. */
  fields: Record<string, Applies>;
  /** «Что это за изделие» (элементы): у благоустройства не обязательно. */
  elements: Applies;
  /** «Как поставляется»: спрашиваем, если от ответа зависит обязательный рисунок сборки. */
  kit: Applies;
  type: ProductType;
}

/** Применимость по категории и типу. `cat` — запись справочника «Категории паспортов» (обязательные поля и рисунки). */
export function applicability(code: string, cat: { requiredFields?: string; requiredImages?: string } | null | undefined, type: ProductType): Applicability {
  const fields: Record<string, Applies> = {};
  for (const k of COMMON_FIELDS) fields[k] = 'optional';
  for (const k of OPTIONAL_FIELDS_BY_CATEGORY[code] ?? []) fields[k] = 'optional';
  for (const [k] of requiredFieldsOf(code, cat)) fields[k] = 'required';
  return {
    fields,
    elements: code === 'BLG' ? 'optional' : 'required',
    kit: /если разборн/i.test(String(cat?.requiredImages ?? '')) ? 'required' : 'optional',
    type,
  };
}
