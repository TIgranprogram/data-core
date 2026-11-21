import { createHash } from 'crypto';

const stable = (value: unknown): unknown => {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'toHexString' in value && typeof value.toHexString === 'function') return value.toHexString();
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
};

/** Квитанция отмены не зависит от JSON-представления ObjectId/Date и порядка ключей. */
export const bulkFingerprint = (row: Record<string, unknown>, keys: string[]) => createHash('sha256')
  .update(JSON.stringify(Object.fromEntries([...keys].sort().map(key => [key, stable(row[key])])))).digest('hex');

/** CAS по прочитанным полям; отсутствующее значение отличается от непустого конкурентного ввода. */
export function bulkExpected(row: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries([...new Set(keys)].map(key => [key, Object.prototype.hasOwnProperty.call(row, key) ? row[key] : { $exists: false }]));
}
