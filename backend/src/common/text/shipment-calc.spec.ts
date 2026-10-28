import { remaining, stageAfterShipments } from './shipment-calc';

const inc = [{ id: 'a', qty: 15 }, { id: 'b', qty: 4 }, { id: 'c' }];
const ship = (...l: Array<[string, number]>) => ({ lines: l.map(([incomeId, qty]) => ({ incomeId, qty })) });

describe('остаток отгрузки', () => {
  it('15 урн, отгружено 5 — осталось 10; позиция без qty остатка не имеет', () => {
    const r = remaining(inc, [ship(['a', 5])]);
    expect(r[0]).toEqual({ incomeId: 'a', qty: 15, shipped: 5, left: 10 });
    expect(r[2]).toEqual({ incomeId: 'c', qty: 0, shipped: 0, left: 0 });
  });
  it('несколько отгрузок суммируются, ниже нуля не уходит', () => {
    expect(remaining(inc, [ship(['b', 1]), ship(['b', 3.5])])[1].left).toBe(0);
  });
});

describe('этап после отгрузок', () => {
  const part = remaining(inc, [ship(['a', 5])]);
  const full = remaining(inc, [ship(['a', 15], ['b', 4])]);
  it('первая отгрузка — частично, всё — отгружен', () => {
    expect(stageAfterShipments('ready', part, 1)).toBe('partly');
    expect(stageAfterShipments('partly', full, 2)).toBe('shipped');
  });
  it('отмена: остались отгрузки — частично, не осталось — готов к отгрузке', () => {
    expect(stageAfterShipments('shipped', part, 1)).toBe('partly');
    expect(stageAfterShipments('partly', remaining(inc, []), 0)).toBe('ready');
  });
  it('закрытый и отменённый не трогаем; без отгрузок «в производстве» остаётся', () => {
    expect(stageAfterShipments('closed', full, 2)).toBe('closed');
    expect(stageAfterShipments('cancelled', part, 1)).toBe('cancelled');
    expect(stageAfterShipments('production', remaining(inc, []), 0)).toBe('production');
  });
});
