import { APP_SECTION_IDS } from '../app-sections';
import { WORK_ROLES, WorkRolesSeed } from './work-roles.seed';

describe('сид ролей «Рабочий» и «Мастер» (C050)', () => {
  it('разделы ролей есть в списке разделов; деньги выключены; мастер — на базе менеджера', () => {
    for (const r of WORK_ROLES) {
      expect(r.appSections.every((s) => APP_SECTION_IDS.includes(s))).toBe(true);
      expect(r.money).toBe(false);
    }
    expect(WORK_ROLES.find((r) => r.name === 'worker')).toMatchObject({ baseRole: 'user', appSections: ['my-tasks'] });
    expect(WORK_ROLES.find((r) => r.name === 'master')).toMatchObject({ baseRole: 'manager', appSections: ['work', 'my-tasks'] });
  });

  it('создаёт только отсутствующие роли; существующую (с правками директора) не трогает', async () => {
    const created: string[] = [];
    const roles = { findByName: jest.fn(async (n: string) => (n === 'worker' ? { name: 'worker', appSections: ['my-tasks', 'stock'] } : null)), create: jest.fn(async (d: { name: string }) => { created.push(d.name); }) };
    await new WorkRolesSeed(roles as never).onApplicationBootstrap();
    expect(created).toEqual(['master']);
  });
});
