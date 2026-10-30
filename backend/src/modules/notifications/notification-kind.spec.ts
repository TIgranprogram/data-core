import { kindFilter, kindOf, unreadCounts } from './notification-kind';

describe('вид уведомления', () => {
  it('известные типы действий — важные', () => {
    for (const t of ['task_assigned', 'invoice_awaiting_payment', 'request_returned']) expect(kindOf(t)).toBe('important');
  });
  it('обновления, импорт и неизвестное — система', () => {
    for (const t of ['app_update', 'import_done', 'zzz', undefined]) expect(kindOf(t)).toBe('system');
  });
  it('сохранённый вид главнее типа', () => {
    expect(kindOf('task_assigned', 'system')).toBe('system');
    expect(kindOf('import_done', 'important')).toBe('important');
  });
  it('счётчики делятся по виду, старые записи — по типу', () => {
    expect(unreadCounts([
      { _id: { kind: 'important', type: 'x' }, n: 2 },
      { _id: { kind: null, type: 'task_assigned' }, n: 3 },
      { _id: { kind: null, type: 'import_done' }, n: 4 },
      { _id: { kind: 'system', type: 'message' }, n: 1 },
    ])).toEqual({ important: 5, system: 5 });
    expect(unreadCounts([])).toEqual({ important: 0, system: 0 });
  });
  it('message больше не важное', () => {
    expect(kindOf('message')).toBe('system');
  });
  it('фильтр учитывает записи без kind', () => {
    expect(JSON.stringify(kindFilter('important'))).toContain('"kind":null');
    expect(JSON.stringify(kindFilter('system'))).toContain('$nin');
  });
});
