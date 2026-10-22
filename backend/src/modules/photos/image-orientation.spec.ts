import sharp from 'sharp';
import { buildRotatedCopy } from './image-orientation';

async function jpeg(w: number, h: number, orientation?: number): Promise<Buffer> {
  const img = sharp({ create: { width: w, height: h, channels: 3, background: '#336699' } });
  return (orientation ? img.withMetadata({ orientation }) : img).jpeg().toBuffer();
}

describe('buildRotatedCopy', () => {
  it('orientation 6: создаёт копию с переставленными шириной и высотой', async () => {
    const res = await buildRotatedCopy(await jpeg(40, 20, 6));
    expect(res.orientation).toBe(6);
    expect(res.rotated).not.toBeNull();
    expect(res.rotated!.width).toBe(20);
    expect(res.rotated!.height).toBe(40);
    const m = await sharp(res.rotated!.data).metadata();
    expect([m.width, m.height]).toEqual([20, 40]);
  });

  it('orientation 1: копия не создаётся', async () => {
    const res = await buildRotatedCopy(await jpeg(40, 20, 1));
    expect(res.rotated).toBeNull();
  });

  it('без EXIF: копия не создаётся', async () => {
    const res = await buildRotatedCopy(await jpeg(40, 20));
    expect(res.rotated).toBeNull();
  });
});
