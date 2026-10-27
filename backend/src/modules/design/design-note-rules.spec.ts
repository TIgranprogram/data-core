import { canChangeNote, EDIT_WINDOW_MS, initialsOf } from './design-note-rules';

describe('правила обсуждения', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  const note = { authorId: 'u1', createdAt: new Date(now - 60_000), source: 'app' };
  it('инициалы', () => {
    expect(initialsOf('Иван Петров')).toBe('ИП');
    expect(initialsOf('  мария ')).toBe('М');
    expect(initialsOf('')).toBe('?');
  });
  it('автор правит в течение 15 минут, потом нет', () => {
    expect(canChangeNote(note, { id: 'u1', role: 'manager' }, now)).toBe(true);
    expect(canChangeNote({ ...note, createdAt: new Date(now - EDIT_WINDOW_MS - 1) }, { id: 'u1', role: 'manager' }, now)).toBe(false);
  });
  it('чужой — нет, admin — всегда', () => {
    expect(canChangeNote(note, { id: 'u2', role: 'manager' }, now)).toBe(false);
    expect(canChangeNote({ ...note, createdAt: new Date(0) }, { id: 'u2', role: 'admin' }, now)).toBe(true);
  });
  it('импортную запись автор не правит', () => {
    expect(canChangeNote({ ...note, source: 'yougile' }, { id: 'u1', role: 'manager' }, now)).toBe(false);
  });
});
