import { Types } from 'mongoose';

/** Зоны по умолчанию (сид идемпотентный: недостающие по `code` добавляются, существующие не трогаются). */
export const DEFAULT_ZONES: Array<{ code: string; name: string; hint: string; order: number }> = [
  { code: 'contracts', name: 'Договоры', hint: 'Заказы, договоры, сроки отгрузки', order: 10 },
  { code: 'design_dispatch', name: 'Распределение проектирования', hint: 'Раздать задачи, следить за сроками', order: 20 },
  { code: 'design', name: 'Проектирование', hint: 'Выполнение задач, ответы на вопросы', order: 30 },
  { code: 'supply', name: 'Снабжение', hint: 'Заявки, счета поставщиков, поставки', order: 40 },
  { code: 'stock', name: 'Склад', hint: 'Приёмка, выдача, остатки', order: 50 },
  { code: 'accounting', name: 'Бухгалтерия', hint: 'Оплаты, поступления, ФОТ', order: 60 },
  { code: 'passports', name: 'Паспорта', hint: 'Паспорта изделий к отгрузке', order: 70 },
  { code: 'management', name: 'Руководство', hint: 'Неназначенные зоны, всё просроченное', order: 80 },
];
export const MANAGEMENT = 'management';

export interface RouteInput {
  /** Личный ответственный объекта: вход сотрудника (null — сотрудник есть, входа нет). */
  personal?: { userId?: string | null } | null;
  /** Люди зоны события (только userId; null — без входа). */
  zoneUsers: Array<string | null | undefined>;
  /** Входы зоны «Руководство». */
  managementUsers: string[];
}
export interface Route {
  userIds: string[];
  /** Какая зона отправила (для `zoneCode` уведомления). */
  zoneCode: string;
  /** Зона события осталась без адресата — уведомление ушло руководству. */
  unassigned: boolean;
  /** Кому ушло: личному / людям зоны / руководству. */
  via: 'personal' | 'zone' | 'management';
}

const uniq = (a: Array<string | null | undefined>) => [...new Set(a.filter((x): x is string => !!x))];

/** Адресация (ЗО §4.6): личный → люди зоны → «Руководство» с пометкой «Не назначено». */
export function routeNotice(zoneCode: string, i: RouteInput): Route {
  const personal = i.personal?.userId ? [String(i.personal.userId)] : [];
  if (personal.length) return { userIds: personal, zoneCode, unassigned: false, via: 'personal' };
  const zone = uniq(i.zoneUsers);
  if (zone.length) return { userIds: zone, zoneCode, unassigned: false, via: 'zone' };
  return { userIds: uniq(i.managementUsers), zoneCode, unassigned: true, via: 'management' };
}

/** Текст напоминания «Не назначено: Паспорта, Склад». */
export const unassignedText = (names: string[]) => `Не назначено: ${names.join(', ')}`;

/** Сотрудник виден как «работающий»: уволенные в зоне не считаются. */
export const isWorking = (p: { status?: string | null }) => (p.status ?? 'active') !== 'fired';

export const oidOrNull = (v: unknown) => (v && Types.ObjectId.isValid(String(v)) ? new Types.ObjectId(String(v)) : null);

/** Имя сотрудника: «Фамилия Имя Отчество». */
export const personLabel = (p: object) => {
  const x = p as { lastName?: string; firstName?: string; patronymic?: string };
  return [x.lastName, x.firstName, x.patronymic].map((v) => String(v ?? '').trim()).filter(Boolean).join(' ');
};
