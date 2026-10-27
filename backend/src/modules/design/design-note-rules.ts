/** Правила обсуждения задачи (чистые функции, без базы). */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Инициалы для кружка автора: до двух первых букв слов имени. */
export function initialsOf(name: string): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p.charAt(0)).join('').toUpperCase() || '?';
}

/** Править или удалять запись: admin — всегда; автор — комментарий в течение 15 минут (импортные записи — только admin). */
export function canChangeNote(note: { authorId?: unknown; createdAt?: Date | string | null; source?: string }, user: { id: string; role: string }, now = Date.now()): boolean {
  if (user.role === 'admin') return true;
  if (!note.authorId || String(note.authorId) !== String(user.id) || note.source === 'yougile') return false;
  const at = note.createdAt ? new Date(note.createdAt).getTime() : 0;
  return now - at <= EDIT_WINDOW_MS;
}
