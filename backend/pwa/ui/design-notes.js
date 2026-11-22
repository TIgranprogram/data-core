import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { plural } from '../core/format.js';
import { viewAsActive } from '../core/view-as.js';
import { taskDiscussion } from './kit/task-discussion.js';

const questionsText = (n) => `${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')}`;
const legacyCount = (n) => n.legacyPhotoCount ?? (n.kind !== 'question' && /^(\s*\[фото\]\s*)+$/i.test(n.text || '') ? (n.text.match(/\[фото\]/gi) || []).length : 0);
const designNotes = new WeakMap();
function readDesignNotes(row, fresh) {
  if (fresh || !designNotes.has(row)) {
    const promise = api(`/design-tasks/${row.id}/notes`).then(({ items }) => items || []).catch((error) => {
      if (designNotes.get(row) === promise) designNotes.delete(row);
      throw error;
    });
    designNotes.set(row, promise);
  }
  return designNotes.get(row);
}

/** Импортные отметки загрузки сохраняют исходное время и автора. */
export async function designPhotoHistory(row) {
  return (await readDesignNotes(row)).filter(legacyCount).map((note) => ({
    action: 'designtask.photo.added', label: `Добавлено фото · ${legacyCount(note)}`, userName: note.author.name, createdAt: note.createdAt,
  }));
}

export function discussionBlock(row, ctx, { open = false } = {}) {
  const path = `/design-tasks/${row.id}/notes`;
  const canWrite = Boolean(session.name) && !viewAsActive();
  return taskDiscussion({ open, count: row.notesCount, canWrite, canAttach: canWrite && session.canEdit,
    loadNotes: async (fresh) => (await readDesignNotes(row, fresh)).filter((note) => !legacyCount(note)),
    create: (body) => api(path, { method: 'POST', body }),
    remove: (id) => api(`/design-notes/${id}`, { method: 'DELETE' }),
    onChange: (items) => {
      row.notesCount = items.length;
      row.openQuestions = items.filter((n) => n.kind === 'question' && n.needsAnswer).length;
      ctx.changed?.();
    },
  });
}

/** Значок на карточке и в списке, пока остался открытый вопрос. */
export const questionBadge = (t) => (t?.openQuestions > 0
  ? h('span', { class: 'stk warn dn-badge', title: 'Без ответа: ' + questionsText(t.openQuestions), 'aria-label': 'Без ответа: ' + questionsText(t.openQuestions) }, '? ' + t.openQuestions)
  : null);
