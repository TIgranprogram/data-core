import { isMine, pickScope, ZONE_OF } from './today-scope';

describe('today-scope: «Моё / Всё»', () => {
  it('кладовщик: по умолчанию «Моё»; оплаты и задачи проектирования не его', () => {
    const s = pickScope(undefined, { zoneCodes: ['stock'], management: false });
    expect(s.mode).toBe('mine');
    const me = { personId: 'p1', zoneCodes: s.zoneCodes };
    expect(isMine({ zoneCode: ZONE_OF.payment }, me)).toBe(false);
    expect(isMine({ zoneCode: ZONE_OF.design }, me)).toBe(false);
  });
  it('переключил «Всё» — режим all', () => {
    expect(pickScope('all', { zoneCodes: ['stock'], management: false }).mode).toBe('all');
  });
  it('Руководство по умолчанию «Всё»', () => {
    expect(pickScope(undefined, { zoneCodes: ['management'], management: true }).defaultMode).toBe('all');
  });
  it('вход не связан с сотрудником — «Всё» и linked=false', () => {
    const s = pickScope('mine', null);
    expect(s).toMatchObject({ mode: 'all', linked: false, defaultMode: 'all' });
  });
  it('личный ответственный главнее зоны', () => {
    const me = { personId: 'p1', zoneCodes: ['design'] };
    expect(isMine({ zoneCode: 'design', personId: 'p2' }, me)).toBe(false);
    expect(isMine({ zoneCode: 'supply', personId: 'p1' }, me)).toBe(true);
  });
});
