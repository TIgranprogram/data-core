/**
 * C060: свои тексты изделия в паспорте — `products.passportDefaults.textOverrides` → `productpassports.textOverrides`:
 * { id раздела воронки: { text?: свой текст вместо выбранного варианта, off?: true — раздел не печатается } }.
 * Справочник «Тексты паспорта» не меняется. Чистые функции без БД.
 */
export interface TextOverride { text?: string; off?: boolean }
export type TextOverrides = Record<string, TextOverride>;

const OID = /^[0-9a-f]{24}$/i;
export const MAX_OVERRIDE_TEXT = 4000;
/** Разделы, которые идут в поля паспорта (назначение, установка): убрать нельзя — только заменить текст. Совпадает с FIELD_SECTIONS воронки. */
const KEEP_SECTIONS = ['purpose', 'installation'];

/** Разбор из тела запроса / базы: неверные ключи и пустые записи отбрасываются; пусто — undefined. */
export function parseOverrides(raw: unknown): TextOverrides | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: TextOverrides = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!OID.test(id) || !v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const text = typeof o.text === 'string' ? o.text.replace(/\r\n/g, '\n').trim().slice(0, MAX_OVERRIDE_TEXT) : '';
    const off = o.off === true;
    if (off) out[id] = { off: true };
    else if (text) out[id] = { text };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Правка раздела: «убрать» у назначения / установки не работает — у них остаётся замена текста или вариант справочника. */
export function overrideFor(all: unknown, rootId: string, section: string): TextOverride {
  const o = (all && typeof all === 'object' ? (all as Record<string, TextOverride>)[rootId] : undefined) ?? {};
  const off = o.off === true && !KEEP_SECTIONS.includes(section);
  const text = !off && typeof o.text === 'string' ? o.text.trim() : '';
  return { ...(off ? { off: true } : {}), ...(text ? { text } : {}) };
}
