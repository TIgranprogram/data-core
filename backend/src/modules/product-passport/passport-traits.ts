import { ELEMENT_TRAITS, JOINT_TRAITS, MATERIAL_TRAITS, PASSPORT_TRAIT_CODES, USERS_CATEGORIES, whenCodes } from '../../common/passport/traits';
import { evalCondition, parseWhen, TRAITS_FIELD, type ExcludedItem, type PassportCondition } from './passport-compose';
import type { DictRec } from './passport-compose-parts';

/**
 * Признаки изделия для условий `when` (C054): множество кодов из справочников (вид, материал, способ установки) и из выбора
 * «Конструкция» (joints). Три состояния для bolts / welds: да (выбраны), нет (выбрано «цельное» / другое), неизвестно (не выбрано).
 */
export interface TraitsInfo {
  /** Итоговое множество признаков (порядок словаря PASSPORT_TRAITS). */
  traits: string[];
  /** Откуда взялся каждый признак: «Вид изделия: Решётка», «Конструкция». */
  from: Record<string, string[]>;
  /** Признаки без ответа (соединения не выбраны): пункты на них не выводятся, паспорту нужен выбор. */
  unknown: string[];
}

/** Записи справочников с пометкой, откуда признаки (для «traitsFrom»). */
export interface TraitSources { elements: DictRec[]; materials: DictRec[]; install: DictRec | null }

const codesOf = (v: unknown): string[] => (Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/)).map((x) => String(x ?? '').trim()).filter((c) => PASSPORT_TRAIT_CODES.includes(c));

export function collectTraits(joints: unknown, src: TraitSources, category = ''): TraitsInfo {
  const have = new Set<string>();
  const from: Record<string, string[]> = {};
  const add = (code: string, why: string) => {
    have.add(code);
    const list = (from[code] ||= []);
    if (!list.includes(why)) list.push(why);
  };
  const take = (label: string, rec: DictRec | null | undefined) => {
    if (!rec) return;
    for (const c of codesOf(rec.traits)) add(c, `${label}: ${String(rec.name ?? rec.code ?? '').trim()}`);
  };
  src.elements.forEach((r) => take('Вид изделия', r));
  src.materials.forEach((r) => take('Материал', r));
  take('Способ установки', src.install);
  // C094: вид или материал не указан — пункты безопасности остаются; категория BLG людей не подразумевает, остальные (и пустая) — да
  // вид изделия — запись справочника не «часть» и не «крепёж»; материал — не «покрытие»
  const hasKind = src.elements.some((r) => !['part', 'fastener'].includes(String(r.kind ?? '')));
  const hasMaterial = src.materials.some((r) => String(r.kind ?? '') !== 'coating');
  if (!hasKind) for (const c of ELEMENT_TRAITS) add(c, 'Вид изделия не указан');
  if (!hasMaterial) for (const c of MATERIAL_TRAITS) add(c, 'Материал не указан');
  if (!category || USERS_CATEGORIES.includes(category)) add('users', category ? 'Тип паспорта' : 'Категория не указана');
  const j = (Array.isArray(joints) ? joints : []).map(String);
  for (const c of ['bolts', 'welds']) if (j.includes(c)) add(c, 'Конструкция');
  const traits = PASSPORT_TRAIT_CODES.filter((c) => have.has(c));
  const unknown = j.length ? [] : JOINT_TRAITS.filter((c) => !have.has(c));
  const ordered: Record<string, string[]> = {};
  for (const c of traits) ordered[c] = from[c];
  return { traits, from: ordered, unknown };
}

/**
 * Решает `when` у записи справочника (дефект, пиктограмма): true — берём; false — условие не совпало;
 * 'unknown' — условие смотрит на признак без ответа (соединения не выбраны).
 */
export function whenVerdict(when: unknown, info: Pick<TraitsInfo, 'traits' | 'unknown'>): true | false | 'unknown' {
  const w = String(when ?? '').trim();
  if (!w) return true;
  if (whenCodes(w).some((c) => info.unknown.includes(c))) return 'unknown';
  let cond: PassportCondition | undefined;
  try { cond = parseWhen(w); } catch { return true; } // повреждённая строка из базы не прячет запись; проверка — при сохранении
  return evalCondition(cond, { [TRAITS_FIELD]: info.traits });
}

/** Записи справочника с `when` → только подходящие; отброшенные попадают в excluded (section — раздел снимка, key — код записи). */
export function filterByWhen<T extends DictRec>(list: T[], info: TraitsInfo, section: string, excluded: ExcludedItem[]): { kept: T[]; needJoints: boolean } {
  let needJoints = false;
  const kept = list.filter((r) => {
    const v = whenVerdict(r.when, info);
    if (v === true) return true;
    const when = String(r.when).trim();
    excluded.push({ section, key: String(r.code ?? r.id ?? r._id ?? ''), when, ...(v === 'unknown' ? { unknown: true as const } : {}) });
    if (v === 'unknown') needJoints = true;
    return false;
  });
  return { kept, needJoints };
}

/** «Не хватает» для выпуска: соединения не выбраны, а в тексте есть пункты или дефекты на болты / сварку. */
export const JOINTS_MISSING = { label: 'Как соединены части (болты, сварка)', key: 'joints', hint: 'Отметьте, как соединены части: скручены болтами, сварены, или цельное (бетон, литьё). От этого зависят пункты осмотра в паспорте: «подтягивать болты», «осматривать швы». Обычно у металлического изделия — и болты, и сварка' };

/** По снимку текста паспорта: список из одного пункта «Конструкция: выберите» или пустой. */
export const jointsMissing = (doc: { textSnapshot?: unknown }): Array<typeof JOINTS_MISSING> =>
  (doc.textSnapshot as { needJoints?: boolean } | undefined)?.needJoints ? [JOINTS_MISSING] : [];
