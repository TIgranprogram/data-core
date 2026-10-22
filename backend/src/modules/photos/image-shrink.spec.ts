import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { shrinkInPlace, SHRINK_MAX_SIDE } from './image-shrink';

describe('shrinkInPlace — облегчение фото при загрузке', () => {
  const file = (name: string) => join(tmpdir(), `shrink-${process.pid}-${name}`);

  it('большое фото → ≤ 2560 px, тот же формат, файл легче', async () => {
    const p = file('big.jpg');
    await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 120, g: 160, b: 90 } } }).jpeg({ quality: 100 }).toFile(p);
    const before = (await fs.stat(p)).size;
    const after = await shrinkInPlace(p, 'image/jpeg', before);
    const meta = await sharp(p).metadata();
    expect(after).not.toBeNull();
    expect(Math.max(meta.width!, meta.height!)).toBe(SHRINK_MAX_SIDE);
    expect(meta.format).toBe('jpeg');
    await fs.unlink(p);
  });

  it('лёгкое фото и GIF не трогаем', async () => {
    const p = file('small.png');
    await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toFile(p);
    const size = (await fs.stat(p)).size;
    expect(await shrinkInPlace(p, 'image/png', size)).toBeNull();
    expect(await shrinkInPlace(p, 'image/gif', 10 * 1024 * 1024)).toBeNull();
    expect((await fs.stat(p)).size).toBe(size);
    await fs.unlink(p);
  });

  it('не картинка — без ошибки, файл не меняется', async () => {
    const p = file('bad.jpg');
    await fs.writeFile(p, 'не картинка');
    expect(await shrinkInPlace(p, 'image/jpeg', 5 * 1024 * 1024)).toBeNull();
    await fs.unlink(p);
  });
});
