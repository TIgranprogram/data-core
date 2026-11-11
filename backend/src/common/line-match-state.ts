/**
 * Состояние сопоставления позиции договора (`incomes`) с изделием — чистые правила без зависимостей (КМ2).
 * Лежит в common: правила читают и «Сопоставление», и «Проектирование» (иначе цикл модулей design ↔ matching, C068-9).
 * confirmed | none | legacy (есть изделие, статуса нет — старые данные, считаются сопоставленными)
 * | auto (предложено, не подтверждено) | unmatched | request («Новое изделие»: заявка проектировщику ещё не подтверждена).
 * ORDER-LINES: услуга (lineType service) всегда сопоставлена («не изделие»).
 */
export type LineState = 'confirmed' | 'none' | 'legacy' | 'auto' | 'unmatched' | 'request';
type Doc = Record<string, unknown>;

export const lineState = (l: Doc): LineState => {
  if (l.lineType === 'service') return 'none';
  if (l.lineType === 'new_product' && !l.productId) return 'request';
  const st = l.matchStatus;
  if (st === 'none') return 'none';
  if (st === 'confirmed') return l.productId ? 'confirmed' : 'unmatched';
  if (st === 'auto') return 'auto';
  return l.productId ? 'legacy' : 'unmatched';
};
export const isMatched = (l: Doc): boolean => ['confirmed', 'none', 'legacy'].includes(lineState(l));

/** «Не распределена»: у позиции нет изделия, и это не услуга и не «не изделие». */
export const isUnassigned = (l: Doc): boolean => !l.productId && !isMatched(l);
