/** Вид уведомления: «Важные» (от людей, действия) и «Система» (обновления, импорт, сервисные). */
export const NOTICE_KINDS = ['important', 'system'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** Типы, которые требуют действия человека: сообщение, задача, счёт ждёт оплаты, заявка вернулась. */
export const IMPORTANT_TYPES = ['message', 'task_assigned', 'invoice_awaiting_payment', 'request_returned', 'zone_unassigned'] as const;

/** Вид по типу; записи без вида (старые) — «Система», кроме известных типов действий. */
export function kindOf(type: string | undefined | null, stored?: string | null): NoticeKind {
  if (stored === 'important' || stored === 'system') return stored;
  return (IMPORTANT_TYPES as readonly string[]).includes(String(type ?? '')) ? 'important' : 'system';
}

/** Фильтр Mongo по виду (учитывает старые записи без `kind`). */
export function kindFilter(kind: NoticeKind): Record<string, unknown> {
  const known = [...IMPORTANT_TYPES];
  return kind === 'important'
    ? { $or: [{ kind: 'important' }, { kind: null, type: { $in: known } }] }
    : { $or: [{ kind: 'system' }, { kind: null, type: { $nin: known } }] };
}

/** Непрочитанные по строкам группировки {_id:{kind,type}, n} → {important, system}. */
export function unreadCounts(rows: Array<{ _id: { kind?: string | null; type?: string }; n: number }>): Record<NoticeKind, number> {
  const out: Record<NoticeKind, number> = { important: 0, system: 0 };
  for (const r of rows) out[kindOf(r._id?.type, r._id?.kind)] += r.n;
  return out;
}
