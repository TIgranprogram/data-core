const GB = 1024 ** 3;
const gb = (n: number) => (Math.round((n / GB) * 10) / 10).toLocaleString('ru-RU') + ' ГБ';

export interface CapacityLimits { ceilingBytes: number; minFreeBytes: number; sharePct: number }

/** Потолок вложений: 50 ГБ или 70 % места (вложения + свободное), что меньше; на диске всегда остаётся запас 1 ГБ. */
export function capacityLimits(env: NodeJS.ProcessEnv = process.env): CapacityLimits {
  const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && v !== undefined && v !== '' ? n : d; };
  return { ceilingBytes: num(env.ATTACHMENT_TOTAL_MAX_BYTES, 50 * GB), minFreeBytes: num(env.ATTACHMENT_MIN_FREE_BYTES, GB), sharePct: 70 };
}

/** Можно ли принять ещё `incoming` байт. Возвращает текст отказа по-русски или `null`. */
export function capacityError(usedByAttachments: number, freeBytes: number, incoming: number, lim: CapacityLimits = capacityLimits()): string | null {
  if (freeBytes - incoming < lim.minFreeBytes) return `На диске сервера не хватает места для этого файла (свободно ${gb(freeBytes)}). Сообщите администратору.`;
  const ceiling = Math.min(lim.ceilingBytes, ((usedByAttachments + freeBytes) * lim.sharePct) / 100);
  if (usedByAttachments + incoming > ceiling) return `Место для вложений исчерпано: занято ${gb(usedByAttachments)} из ${gb(ceiling)}. Удалите ненужные файлы или сообщите администратору.`;
  return null;
}
