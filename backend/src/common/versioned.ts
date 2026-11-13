import { ConflictException } from '@nestjs/common';

/**
 * C049-1 — защита от тихой перезаписи правок двух людей.
 *
 * Клиент присылает `version` записи, которую видел. Совпала — правка проходит и `version` +1.
 * Не совпала — 409 `code: STALE`, база не меняется. Не прислал — прежнее поведение (внешние ключи, старые вкладки).
 * `version` растёт только от правки человеком; каскады и служебные записи её не трогают — иначе ложные 409.
 * Тело 409 — без записи: ошибка идёт мимо маски денег.
 */
export const STALE_CODE = 'STALE';

/** Условие фильтра updateOne. Нет поля в документе = версия 0. */
export function versionFilter(v: number | undefined | null): Record<string, unknown> {
  if (v === undefined || v === null) return {};
  return v === 0 ? { $or: [{ version: 0 }, { version: { $exists: false } }] } : { version: v };
}

/** Документ уже изменён после того, как клиент его прочитал. */
export function isStale(cur: { version?: unknown } | null | undefined, v: number | undefined | null): boolean {
  return v !== undefined && v !== null && Number(cur?.version ?? 0) !== Number(v);
}

export function staleError(what = 'Запись'): ConflictException {
  return new ConflictException({ message: `${what} уже изменили — обновите и повторите`, code: STALE_CODE });
}
