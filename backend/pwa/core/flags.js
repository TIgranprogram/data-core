import { api } from './api.js';

/**
 * Флаги функций (модуль feature-flag, коллекция featureflags): включён = isActive && enabledByDefault.
 * Новое за флагом (БЗ-6 «Паспорта v2» — `passports.v2`) без флага не показывается; нет флага / нет сети — выключен.
 * Кэш на минуту — переключение админом подхватывается без перезагрузки.
 */
const cache = new Map();
export function flag(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.p;
  const p = api(`/feature-flags/${encodeURIComponent(key)}`).then((f) => !!(f?.isActive && f?.enabledByDefault)).catch(() => false);
  cache.set(key, { p, at: Date.now() });
  return p;
}
