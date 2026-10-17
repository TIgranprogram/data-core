import { decodeMulterOriginalName } from './image-upload.options';

describe('decodeMulterOriginalName (TZ-UX-332)', () => {
  it('restores Cyrillic names that Multer decoded as latin1', () => {
    const mojibake = Buffer.from('Снимок экрана.png', 'utf8').toString('latin1');
    expect(decodeMulterOriginalName(mojibake)).toBe('Снимок экрана.png');
  });

  it('leaves already-correct Cyrillic untouched', () => {
    expect(decodeMulterOriginalName('Снимок экрана.png')).toBe('Снимок экрана.png');
  });

  it('leaves ASCII filenames untouched', () => {
    expect(decodeMulterOriginalName('product.png')).toBe('product.png');
  });
});
