/** Порядок этапов заявки (для «вернулась на прежний этап»). */
const RANK: Record<string, number> = { in_progress: 0, requested: 1, ordered: 2, received: 3 };

/** Заявка вернулась на прежний этап или отменена — автору нужно знать. null — ничего не случилось. */
export function requestReturn(prev: string | undefined, next: string | undefined): 'cancelled' | 'back' | null {
  if (!prev || !next || prev === next) return null;
  if (next === 'cancelled') return 'cancelled';
  return prev in RANK && next in RANK && RANK[next] < RANK[prev] ? 'back' : null;
}

const STATUS_RU: Record<string, string> = { in_progress: 'В работе', requested: 'Запрошено', ordered: 'Заказано', received: 'Получено' };

/** Текст уведомления автору заявки. */
export function requestReturnText(kind: 'cancelled' | 'back', num: unknown, title: unknown, next: string): string {
  const name = `${num ? `№${num} ` : ''}${String(title ?? '').trim() || 'без названия'}`;
  return kind === 'cancelled' ? `Заявка ${name} отменена` : `Заявка ${name} вернулась на этап «${STATUS_RU[next] ?? next}»`;
}
