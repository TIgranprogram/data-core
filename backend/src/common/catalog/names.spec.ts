import { materialRequestTitle, ourProductLabel, productShortName } from './names';

describe('names (ТИ-8)', () => {
  it('Н-2: цепочка name → fullName → orderName → sku', () => {
    expect(productShortName({ name: 'Скамья', fullName: 'Длинная' })).toBe('Скамья');
    expect(productShortName({ name: ' ', fullName: 'Длинная', orderName: 'З' })).toBe('Длинная');
    expect(productShortName({ orderName: 'З', sku: 'S1' })).toBe('З');
    expect(productShortName({ sku: 'S1' })).toBe('S1');
  });
  it('«Наше»: sku · name, без дубля', () => {
    expect(ourProductLabel({ sku: 'S1', name: 'Скамья' })).toBe('S1 · Скамья');
    expect(ourProductLabel({ sku: 'S1' })).toBe('S1');
    expect(ourProductLabel({ name: 'Скамья' })).toBe('Скамья');
  });
  it('Н-1: «в счёте», иначе короткое', () => {
    expect(materialRequestTitle({ name: 'Болт', invoiceName: 'Болт М10х50 DIN933' })).toBe('Болт М10х50 DIN933');
    expect(materialRequestTitle({ name: 'Болт' })).toBe('Болт');
  });
});
