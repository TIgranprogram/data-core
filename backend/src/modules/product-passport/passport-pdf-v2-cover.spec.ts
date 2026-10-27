import { coverNameFontSize } from './passport-pdf-v2-cover';

describe('coverNameFontSize', () => {
  const h = (chars: number) => (t: string, fs: number) => Math.ceil((t.length * fs * 0.5) / chars) * fs * 1.2;
  it('короткое название — 14', () => expect(coverNameFontSize('Скамья', h(300))).toBe(14));
  it('длинное — меньше 14, не меньше 8', () => {
    const fs = coverNameFontSize('х'.repeat(160), h(300));
    expect(fs).toBeLessThan(14); expect(fs).toBeGreaterThanOrEqual(8);
  });
  it('сверхдлинное — минимум 8', () => expect(coverNameFontSize('х'.repeat(5000), h(300))).toBe(8));
});
