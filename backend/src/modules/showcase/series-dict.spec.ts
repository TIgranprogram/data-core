import { seriesInDict, seriesOptions } from '../../common/passport/form-values';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildPlan } = require('../../../scripts/series-dict-fill.js');

describe('серии изделий (ИЗ-18)', () => {
  it('варианты формы — только справочник, с числом изделий', () => {
    const r = seriesOptions(['Сказка', 'Атлет', 'сказка'], ['Сказка', ' сказка ', 'Старая', null]);
    expect(r).toEqual([{ value: 'Атлет', n: 0 }, { value: 'Сказка', n: 2 }]);
  });

  it('проверка серии: без регистра и пробелов', () => {
    expect(seriesInDict(' СКАЗКА ', ['Сказка'])).toBe(true);
    expect(seriesInDict('Другая', ['Сказка'])).toBe(false);
  });

  it('скрипт: в справочник идут новые серии, написание — самое частое', () => {
    const plan = buildPlan([{ series: 'Сказка' }, { series: 'сказка' }, { series: 'сказка' }, { series: 'Атлет' }, { series: '' }, {}], ['атлет']);
    expect(plan.add).toEqual([{ name: 'сказка', uses: 3 }]);
    expect(plan.distinct).toBe(2);
  });

  it('скрипт: повторный запуск — нечего добавлять', () => {
    expect(buildPlan([{ series: 'Сказка' }], ['Сказка']).add).toEqual([]);
  });
});
