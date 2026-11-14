import sharp from 'sharp';
import { boostFaint, renameDeep, withContractName } from './passport-print-tune';

describe('passport-print-tune (пользователь 14.11)', () => {
  it('название из договора: заменяет и с точкой, и без неё; хранимый снимок не трогает', () => {
    const p = { name: 'Экотропа 120 м.п.', textSnapshot: { description: ['Экотропа 120 м.п (далее — изделие)'], warranty: { title: 'Экотропа 120 м.п.' } } };
    const out = withContractName(p, 'Экотропа');
    expect(out.name).toBe('Экотропа');
    expect(out.textSnapshot).toEqual({ description: ['Экотропа (далее — изделие)'], warranty: { title: 'Экотропа' } });
    expect(p.name).toBe('Экотропа 120 м.п.');
  });

  it('то же название или пустая строка договора — паспорт как есть', () => {
    const p = { name: 'Качели', textSnapshot: { a: 'Качели' } };
    expect(withContractName(p, 'Качели')).toBe(p);
    expect(withContractName(p, '  ')).toBe(p);
    expect(withContractName(p, undefined)).toBe(p);
  });

  it('renameDeep: короткое старое название (< 3 знаков) не заменяется — не порвать текст', () => {
    expect(renameDeep({ s: 'АБ и АБВ' }, 'АБ', 'X')).toEqual({ s: 'АБ и АБВ' });
  });

  const img = async (bg: number, line: number) => {
    const w = 60, h = 20, raw = Buffer.alloc(w * h * 3, bg);
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) raw[(10 * w + x) * 3 + c] = line; // одна линия
    return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  };

  it('блёклый рисунок (светло-серая линия на белом) — линия становится тёмной', async () => {
    const out = await boostFaint(await img(255, 200));
    const st = await sharp(out).greyscale().stats();
    expect(st.channels[0].min).toBeLessThan(40);
    expect(st.channels[0].max).toBe(255);
  });

  it('рисунок с тёмными местами не трогается', async () => {
    const src = await img(255, 20);
    expect(await boostFaint(src)).toBe(src);
  });
});
