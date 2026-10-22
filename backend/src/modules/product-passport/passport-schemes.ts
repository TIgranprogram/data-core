/**
 * Стандартные схемы узлов (БЗ-6 Э9.5): у записи справочника «Способы установки» — картинки по видам (фундамент, скважины,
 * монтаж). В паспорт попадают схемы его способа установки по тем видам, где своих картинок нет; в паспорте — выбор
 * `schemeSource`: 'standard' (по умолчанию) или 'own' (только свои).
 */
export const SCHEME_FIELDS: Record<string, string> = { foundation: 'schemesFoundation', holes: 'schemesHoles', mounting: 'schemesMounting' };

export interface SchemeImage { kind: string; photoId: string; standard: true }

export function standardSchemes(
  passport: { images?: Array<{ kind: string }>; schemeSource?: string | null },
  install: Record<string, unknown> | null | undefined,
): SchemeImage[] {
  if (!install || passport.schemeSource === 'own') return [];
  const own = new Set((passport.images || []).map((i) => i.kind));
  return Object.entries(SCHEME_FIELDS).flatMap(([kind, field]) => {
    if (own.has(kind)) return [];
    const ids = Array.isArray(install[field]) ? (install[field] as unknown[]).map(String) : [];
    return ids.map((photoId) => ({ kind, photoId, standard: true as const }));
  });
}
