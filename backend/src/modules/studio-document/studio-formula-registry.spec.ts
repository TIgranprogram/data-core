import { evaluateStudioFormula, STUDIO_FORMULA_REGISTRY } from './studio-formula-registry';

describe('studio-formula-registry (TZ-NX-DOCSTUDIO-S23)', () => {
  const columns = [{ key: 'sum', label: 'Sum', type: 'sum' }];
  const rows = [['1000']];

  it('exposes first-version formulas', () => {
    expect(STUDIO_FORMULA_REGISTRY.map((item) => item.id)).toEqual([
      'column-sum',
      'percent-of-subtotal',
      'vat',
      'grand-with-vat',
    ]);
  });

  it('evaluates vat using organization rate', () => {
    expect(evaluateStudioFormula('vat', columns, rows, 22)).toBe('220,00');
  });
});
