import { DEFAULT_ZONES, routeNotice, unassignedText } from './zone-routing';
import { ZonesService } from './zones.service';

describe('адресация: личный → зона → Руководство', () => {
  it('личный ответственный со входом получает один', () => {
    const r = routeNotice('supply', { personal: { userId: 'u1' }, zoneUsers: ['u2', 'u3'], managementUsers: ['d'] });
    expect(r).toMatchObject({ userIds: ['u1'], via: 'personal', unassigned: false, zoneCode: 'supply' });
  });
  it('нет личного — все люди зоны со входом, без повторов', () => {
    const r = routeNotice('supply', { personal: null, zoneUsers: ['u2', null, 'u2', 'u3'], managementUsers: ['d'] });
    expect(r).toMatchObject({ userIds: ['u2', 'u3'], via: 'zone', unassigned: false });
  });
  it('личный без входа — падает на зону', () => {
    const r = routeNotice('supply', { personal: { userId: null }, zoneUsers: ['u2'], managementUsers: ['d'] });
    expect(r.via).toBe('zone');
  });
  it('в зоне никого или нет входов — Руководство, «Не назначено»', () => {
    const r = routeNotice('stock', { personal: null, zoneUsers: [null], managementUsers: ['d1', 'd2'] });
    expect(r).toMatchObject({ userIds: ['d1', 'd2'], via: 'management', unassigned: true });
  });
  it('8 зон по умолчанию, коды уникальны', () => {
    expect(DEFAULT_ZONES).toHaveLength(8);
    expect(new Set(DEFAULT_ZONES.map((z) => z.code)).size).toBe(8);
  });
});

describe('ZonesService: уведомления и напоминание «Не назначено»', () => {
  const sent: Array<Record<string, unknown>> = [];
  const persons: Record<string, unknown> = {};
  const notified = new Set<string>();
  const conn = { db: { collection: (n: string) => ({
    findOne: async (f: Record<string, unknown>) => (n === 'persons' ? persons[String(f._id)] ?? null : n === 'notifications' ? (notified.has(String(f.userId)) ? { _id: 1 } : null) : null),
  }) } };
  const zoneRows = [{ code: 'passports', name: 'Паспорта', active: true }, { code: 'stock', name: 'Склад', active: true }, { code: 'supply', name: 'Снабжение', active: true }];
  const zonesModel = { find: () => ({ sort: () => ({ lean: () => ({ exec: async () => zoneRows }) }) }) };
  let svc: ZonesService;
  beforeEach(() => {
    sent.length = 0; notified.clear();
    const notices = { safe: async (n: Record<string, unknown>) => { sent.push(n); return true; } };
    svc = new ZonesService(zonesModel as never, {} as never, {} as never, conn as never, notices as never);
  });
  const stub = (zoneUsers: Record<string, string[]>, people: Array<{ zoneCodes: string[] }>) => {
    jest.spyOn(svc as never, 'zoneUserIds' as never).mockImplementation((async (codes: string[]) => zoneUsers[codes[0]] ?? []) as never);
    jest.spyOn(svc as never, 'workingPeople' as never).mockImplementation((async () => people) as never);
  };

  it('в зоне «Снабжение» никого — руководству уходит «Не назначено: Снабжение» с zoneCode', async () => {
    stub({ management: ['d1'] }, []);
    const r = await svc.notifyZone('supply', { type: 'request_new', text: 'Новая заявка' });
    expect(r).toMatchObject({ unassigned: true, sent: 1 });
    expect(sent[0]).toMatchObject({ userId: 'd1', zoneCode: 'supply' });
    expect(String(sent[0].sub)).toContain('Не назначено: Снабжение');
  });
  it('заявка: уведомление получают только люди зоны', async () => {
    stub({ supply: ['s1', 's2'], management: ['d1'] }, []);
    await svc.notifyZone('supply', { type: 'request_new', text: 'x' });
    expect(sent.map((x) => x.userId)).toEqual(['s1', 's2']);
  });
  it('личный ответственный со входом — только ему', async () => {
    stub({ supply: ['s1'], management: ['d1'] }, []);
    const pid = '64b7f0000000000000000001';
    persons[pid] = { _id: pid, userId: 'u9' };
    const r = await svc.notifyZone('supply', { type: 'request_assigned', text: 'x' }, { personId: pid });
    expect(r.via).toBe('personal');
    expect(sent.map((x) => x.userId)).toEqual(['u9']);
  });
  it('напоминание: зоны без людей названы, раз в день на человека', async () => {
    stub({ management: ['64b7f0000000000000000002', '64b7f0000000000000000003'] }, [{ zoneCodes: ['supply'] }]);
    jest.spyOn(svc, 'listZones').mockResolvedValue({ items: [], total: 0, unassigned: [{ code: 'passports', name: 'Паспорта' }, { code: 'stock', name: 'Склад' }] });
    notified.add('64b7f0000000000000000002');
    expect(await svc.remindUnassigned()).toBe(1); // первый уже получал сегодня
    expect(sent[0].text).toBe(unassignedText(['Паспорта', 'Склад']));
  });
});
