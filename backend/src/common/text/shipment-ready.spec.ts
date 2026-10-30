import { shipReadiness } from './shipment-ready';

describe('готовность позиции к отгрузке', () => {
  const line = { id: 'L1', productId: 'P1' };
  it('задание не done — нельзя, с шагом и ссылкой', () => {
    const r = shipReadiness(line, 'O1', { task: { id: 'T1', seq: 12, status: 'work', currentStep: 'Сварка' } });
    expect(r.canShip).toBe(false);
    expect(r.missing).toEqual(['Ещё в работе: Сварка']);
    expect(r.links[0].href).toBe('#work?open=T1');
    expect(r.work).toMatchObject({ code: 'W-12', currentStep: 'Сварка' });
    expect(r.kind).toBe('make');
  });
  it('задание done — можно', () => {
    const r = shipReadiness(line, 'O1', { task: { id: 'T1', seq: 1, status: 'done', currentStep: null } });
    expect(r).toMatchObject({ canShip: true, missing: [], kind: 'make' });
  });
  it('изделие без задания — можно, work null', () => {
    const r = shipReadiness(line, 'O1', {});
    expect(r).toMatchObject({ canShip: true, missing: [], work: null, kind: 'make' });
  });
  it('со склада: бронь не выдана — нельзя; выдана — можно', () => {
    expect(shipReadiness(line, 'O1', { reservations: { active: 1, total: 1 } })).toMatchObject({ canShip: false, kind: 'stock', missing: ['Бронь не выдана со склада'] });
    expect(shipReadiness(line, 'O1', { reservations: { active: 0, total: 1 } })).toMatchObject({ canShip: true, kind: 'stock' });
  });
  it('прочее без изделия — можно, паспорт передаётся', () => {
    const r = shipReadiness({ id: 'L2' }, 'O1', { passport: { id: 'p', status: 'draft' } });
    expect(r).toMatchObject({ canShip: true, kind: 'other', passport: { id: 'p', status: 'draft' } });
  });
});
