import { DataVersionService } from './data-version.service';

describe('Версии разделов для обновления без F5 (СМ.9)', () => {
  const make = () => new DataVersionService({} as never) as unknown as { ver: Map<string, number>; live: boolean; epoch: number; snapshot: DataVersionService['snapshot'] };

  it('раздел — сумма версий его коллекций', () => {
    const s = make(); s.live = true; s.epoch = 2;
    s.ver.set('materials', 3); s.ver.set('reservations', 4); s.ver.set('incomes', 1);
    expect(s.snapshot({ stock: ['materials', 'reservations'], money: ['incomes'], work: ['worktasks'] })).toEqual({ live: true, epoch: 2, v: { stock: 7, money: 1, work: 0 } });
  });
  it('поток не работает — live: false', () => {
    expect(make().snapshot({ stock: ['materials'] }).live).toBe(false);
  });
});
