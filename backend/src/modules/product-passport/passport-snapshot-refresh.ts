import { ConflictException } from '@nestjs/common';
import type { SnapshotItem, SnapshotSection } from './passport-snapshot-edit';

/**
 * C096 Э1: безопасная пересборка снимка текста черновика.
 * Новый снимок собирается по текущим полям, шаблону и справочникам; ручные пункты (`edited`) переносятся по ключу
 * раздела + ключу пункта без изменения текста. Ключ исчез или встречается дважды — конфликт: снимок не меняется.
 */
export type Snap = Record<string, unknown> & { sections?: SnapshotSection[]; editedAt?: unknown; at?: unknown };

export interface CarryResult { sections: SnapshotSection[]; conflicts: string[]; carried: number }

const label = (s: SnapshotSection | undefined, sectionKey: string, i: SnapshotItem) =>
  `${s?.title || sectionKey}${i.number ? ' ' + i.number : ''} «${String(i.text).slice(0, 60)}${String(i.text).length > 60 ? '…' : ''}»`;

/** Перенос ручных пунктов `prev` в свежую сборку `next`. Новая сборка не меняется на месте. */
export function carryManual(prev: SnapshotSection[] | undefined, next: SnapshotSection[]): CarryResult {
  const conflicts: string[] = [];
  let carried = 0;
  const out = next.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i })) }));
  for (const ps of prev ?? []) {
    for (const pi of ps.items ?? []) {
      if (!pi.edited) continue;
      const secs = out.filter((s) => s.key === ps.key);
      const hits = secs.flatMap((s) => s.items.filter((i) => i.key === pi.key));
      if (secs.length !== 1 || hits.length !== 1) {
        conflicts.push(`${label(ps, ps.key, pi)} — ${hits.length ? 'пункт встречается несколько раз' : 'пункта больше нет в тексте категории'}`);
        continue;
      }
      const target = hits[0];
      const base = target.text; // новый текст справочника — исходный для ручной правки
      carried++;
      // Совпадение с новым справочником не отменяет явную ручную правку: следующее обновление не должно её затереть.
      target.text = pi.text;
      target.edited = true;
      target.original = base;
    }
  }
  return { sections: out, conflicts, carried };
}

/** Канонический вид для сравнения: ключи по порядку, без служебного времени снимка. */
export function canon(v: unknown): string {
  return JSON.stringify(v, function (this: unknown, key, val) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(Object.keys(val as object).sort().filter((k) => (val as Record<string, unknown>)[k] !== undefined).map((k) => [k, (val as Record<string, unknown>)[k]]));
    }
    return val;
  });
}

/** Тот же снимок по содержимому: `at` и `editedAt` не учитываются. */
export function sameSnapshot(a: Snap | undefined | null, b: Snap | undefined | null): boolean {
  const strip = (s: Snap | undefined | null) => {
    if (!s) return null;
    const rest = JSON.parse(JSON.stringify(s)) as Snap;
    delete rest.at;
    delete rest.editedAt;
    // Mongoose minimize удаляет пустую карту выбора. Это тот же выбор, а не новая версия снимка.
    if (rest.choices && typeof rest.choices === 'object' && !Array.isArray(rest.choices) && !Object.keys(rest.choices).length) delete rest.choices;
    return rest;
  };
  return canon(strip(a)) === canon(strip(b));
}

/** Понятная ошибка конфликта ручной правки (409): документ не меняется, номер не выдаётся. */
export function manualConflict(conflicts: string[]): ConflictException {
  return new ConflictException({
    message: `Ручные правки текста не переносятся в новый текст: ${conflicts.join('; ')}. Паспорт не изменён. Перенесите правку вручную или нажмите «Обновить текст по справочникам» (правки пропадут).`,
    conflicts,
  });
}
