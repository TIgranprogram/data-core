import type { FeedKind } from './today-feed';
import type { ZoneScope } from '../zones/zones.service';
import { MANAGEMENT } from '../zones/zone-routing';

/** Зона ответственности по виду дела ленты. Отгрузка — «Договоры» (до появления отдельной зоны). */
export const ZONE_OF: Record<FeedKind, string> = { delivery: 'supply', shipment: 'contracts', design: 'design', question: 'design', payment: 'accounting' };

export type ScopeMode = 'mine' | 'all';
export interface ScopeInfo {
  /** Что применено к ленте. */
  mode: ScopeMode;
  /** Что открыть по умолчанию (Руководство и не связанный со входом сотрудник — «Всё»). */
  defaultMode: ScopeMode;
  /** Вход связан с сотрудником; false — показать подсказку «Вход не связан с сотрудником — скажите директору». */
  linked: boolean;
  zoneCodes: string[];
}

/** Выбор режима «Моё / Всё» (ЗО §4.7). Явный `scope` главнее умолчания; без связи со входом «Моё» невозможно. */
export function pickScope(requested: unknown, zs: Pick<ZoneScope, 'zoneCodes' | 'management'> | null): ScopeInfo {
  const linked = !!zs;
  const defaultMode: ScopeMode = !zs || zs.management ? 'all' : 'mine';
  const want = requested === 'mine' || requested === 'all' ? requested : defaultMode;
  return { mode: linked ? want : 'all', defaultMode, linked, zoneCodes: zs?.zoneCodes ?? [] };
}

/** Дело «моё»: у него личный ответственный — только он; иначе — его зона среди зон человека. */
export function isMine(it: { zoneCode?: string; personId?: string }, me: { personId: string | null; zoneCodes: string[] }): boolean {
  if (it.personId) return it.personId === me.personId;
  return !!it.zoneCode && me.zoneCodes.includes(it.zoneCode);
}

export const MANAGEMENT_ZONE = MANAGEMENT;
