import sharp from 'sharp';
import { clearWhiteRgba, normalizeAssetImage } from './asset-image';

async function sample(w = 100, h = 60, exif = false) {
  // белый фон + тёмный квадрат в центре
  const buf = Buffer.alloc(w * h * 3, 255);
  for (let y = 20; y < 40; y++) for (let x = 40; x < 60; x++) { const i = (y * w + x) * 3; buf[i] = 20; buf[i + 1] = 20; buf[i + 2] = 20; }
  let p = sharp(buf, { raw: { width: w, height: h, channels: 3 } });
  if (exif) p = p.withMetadata({ orientation: 6 });
  return p.jpeg().toBuffer();
}
const alphaAt = async (data: Buffer, x: number, y: number) => {
  const r = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return r.data[(y * r.info.width + x) * 4 + 3]!;
};

describe('asset-image', () => {
  it('clearWhiteRgba: светлый → прозрачный, тёмный остаётся, край плавный', () => {
    const out = clearWhiteRgba(Buffer.from([255, 255, 255, 255, 10, 10, 10, 255, 218, 218, 218, 255]));
    expect(out[3]).toBe(0);
    expect(out[7]).toBe(255);
    expect(out[11]).toBeGreaterThan(0);
    expect(out[11]).toBeLessThan(255);
  });

  it('normalize + clearWhite: PNG, фон прозрачный, «печать» непрозрачна', async () => {
    const { data } = await normalizeAssetImage(await sample(), { clearWhite: true });
    expect((await sharp(data).metadata()).format).toBe('png');
    expect(await alphaAt(data, 2, 2)).toBe(0);
    expect(await alphaAt(data, 50, 30)).toBe(255);
  });

  it('без clearWhite фон остаётся непрозрачным', async () => {
    const { data } = await normalizeAssetImage(await sample());
    expect(await alphaAt(data, 2, 2)).toBe(255);
  });

  it('уменьшает до ≤ 800 px и не увеличивает малое', async () => {
    const big = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#123' } }).jpeg().toBuffer();
    const r = await normalizeAssetImage(big);
    expect(Math.max(r.width, r.height)).toBe(800);
    expect((await normalizeAssetImage(await sample())).width).toBe(100);
  });

  it('EXIF-поворот применяется', async () => {
    const r = await normalizeAssetImage(await sample(100, 60, true));
    expect(r.width).toBe(60);
    expect(r.height).toBe(100);
  });
});
