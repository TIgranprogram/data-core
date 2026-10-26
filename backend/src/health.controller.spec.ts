import { backupAgeCheck } from './health.controller';

describe('А3: сторож бэкапа', () => {
  const now = new Date('2026-10-26T12:00:00').getTime();
  it('свежая копия — up', () => expect(backupAgeCheck('2026-10-26T03:15:00', now).backup.status).toBe('up'));
  it('копия старше 30 ч — down', () => expect(backupAgeCheck('2026-10-25T03:00:00', now).backup.status).toBe('down'));
  it('копий нет — down', () => expect(backupAgeCheck(null, now).backup.status).toBe('down'));
  it('папка не подключена — up', () => expect(backupAgeCheck(undefined, now).backup.status).toBe('up'));
});
