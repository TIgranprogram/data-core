import { countGuard } from './stock.service';

describe('countGuard (ФИ.4): пересчёт «сколько лежит всего, вместе с бронью»', () => {
  it('равно учёту или больше брони — можно', () => {
    expect(countGuard(931, 931, 750)).toBeNull();
    expect(countGuard(800, 931, 750)).toBeNull();
    expect(countGuard(750, 931, 750)).toBeNull();
  });
  it('меньше брони — нельзя без подтверждения, с подтверждением — можно', () => {
    expect(countGuard(0, 931, 750)).toContain('Меньше, чем в брони (750): свободно станет -750');
    expect(countGuard(0, 931, 750, true)).toBeNull();
  });
  it('меньше нуля или не число — нельзя даже с подтверждением', () => {
    expect(countGuard(-1, 931, 0, true)).toContain('меньше 0');
    expect(countGuard(Number.NaN, 931, 0, true)).toContain('меньше 0');
  });
});
