import sharp from 'sharp';
import { prepareDimensionImage } from './passport-dimension-image';

const drawing = (border: string, detail = '') => sharp(Buffer.from(`<svg width="1000" height="700"><rect width="1000" height="700" fill="white"/><path d="M1 0V700 M998 0V700" stroke="${border}"/><rect x="400" y="100" width="120" height="380" fill="none" stroke="black" stroke-width="3"/><path d="M350 570H650" stroke="black" stroke-width="3"/>${detail}</svg>`)).png().toBuffer();

describe('Печатная копия габаритного чертежа', () => {
  it('убирает бледные края бумаги, сохраняет нижнюю подпись и поля', async () => {
    const input = await drawing('#a0a0b0');
    const before = Buffer.from(input);
    const output = await prepareDimensionImage(input);
    const meta = await sharp(output).metadata();
    expect(meta.width).toBeLessThan(400);
    expect(meta.height).toBeGreaterThan(480);
    expect(meta.height).toBeLessThan(540);
    expect(input.equals(before)).toBe(true);
  });
  it('не удаляет тёмные выносные линии у края', async () => {
    const output = await prepareDimensionImage(await drawing('black'));
    expect((await sharp(output).metadata()).width).toBeGreaterThanOrEqual(998);
  });
  it('не удаляет бледную линию вместе с тёмной отметкой возле края', async () => {
    const output = await prepareDimensionImage(await drawing('#a0a0b0', '<rect x="2" y="300" width="6" height="9" fill="black"/>'));
    expect((await sharp(output).metadata()).width).toBeGreaterThan(650);
  });
  it('пустая картинка и повреждённый файл не ломают печать', async () => {
    const blank = await sharp({ create: { width: 30, height: 40, channels: 3, background: 'white' } }).png().toBuffer();
    expect(await prepareDimensionImage(blank)).toBeInstanceOf(Buffer);
    const broken = Buffer.from('не картинка');
    expect(await prepareDimensionImage(broken)).toEqual(broken);
  });
  it('узкий рисунок не обрезается как рамка', async () => {
    const input = await sharp({ create: { width: 2, height: 40, channels: 3, background: '#a0a0b0' } }).png().toBuffer();
    const meta = await sharp(await prepareDimensionImage(input)).metadata();
    expect(meta.width).toBeGreaterThanOrEqual(2);
    expect(meta.height).toBeGreaterThanOrEqual(40);
  });
});
