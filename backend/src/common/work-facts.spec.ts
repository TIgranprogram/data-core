import { daysFromHours, hourRate, median, normSum, perUnit, r2 } from './work-facts';

describe('work-facts: нормы и себестоимость (C041 Э3)', () => {
  it('медиана: нечётное — средний, чётное — полусумма двух средних, пусто — null', () => {
    expect(median([4, 2, 6])).toBe(4);
    expect(median([4, 2, 6, 8])).toBe(5);
    expect(median([3])).toBe(3);
    expect(median([])).toBeNull();
    expect(median([1, 2.333])).toBe(1.67);
  });

  it('часы на единицу и дни: округление до сотых/десятых, количество ≥ 1', () => {
    expect(perUnit(30, 3)).toBe(10);
    expect(perUnit(10, 3)).toBe(3.33);
    expect(perUnit(5, 0)).toBe(5); // количество не может быть нулём
    expect(daysFromHours(8)).toBe(1);
    expect(daysFromHours(12)).toBe(1.5);
    expect(r2(1.234)).toBe(1.23);
    expect(r2(1.236)).toBe(1.24);
  });

  it('норма изделия: сумма заполненных часов, пусто — null', () => {
    expect(normSum([1.5, 2, null, undefined])).toBe(3.5);
    expect(normSum([null, undefined])).toBeNull();
  });

  it('ставка часа (Q4): почасовая у сотрудника → своя; иначе ставка вида работ; иначе нет ставки', () => {
    expect(hourRate({ salaryKind: 'hour', salaryRate: 500 }, 300)).toEqual({ rate: 500, source: 'person' });
    expect(hourRate({ salaryKind: 'month', salaryRate: 60000 }, 300)).toEqual({ rate: 300, source: 'worktype' });
    expect(hourRate({ salaryKind: 'hour', salaryRate: 0 }, 300)).toEqual({ rate: 300, source: 'worktype' });
    expect(hourRate(null, null)).toEqual({ rate: null, source: null });
    expect(hourRate({ salaryKind: 'month', salaryRate: 60000 }, 0)).toEqual({ rate: null, source: null });
  });
});
