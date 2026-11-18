import sharp from 'sharp';
import { boostFaint } from './passport-print-tune';

describe('passport-print-tune (пользователь 14.11)', () => {
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
