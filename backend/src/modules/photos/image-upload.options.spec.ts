import { decodeMulterOriginalName, IMAGE_UPLOAD_MIME, uploadFileName } from './image-upload.options';

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

describe('загрузка картинок: тип и расширение (БЗ-6 ЭФ2)', () => {
  it('SVG и не-картинки не принимаются, обычные форматы — да', () => {
    expect(IMAGE_UPLOAD_MIME.test('image/svg+xml')).toBe(false);
    expect(IMAGE_UPLOAD_MIME.test('text/html')).toBe(false);
    for (const m of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']) expect(IMAGE_UPLOAD_MIME.test(m)).toBe(true);
  });
  it('расширение — по типу, имя клиента не используется', () => {
    expect(uploadFileName('image/png')).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(uploadFileName('image/jpeg')).toMatch(/\.jpg$/);
  });
});

describe('PDF-загрузка', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { photoUploadMulterOptions, uploadFileName: name } = require('./image-upload.options');
  it('pdf проходит фильтр, расширение по типу', () => {
    const cb = jest.fn();
    photoUploadMulterOptions.fileFilter({}, { mimetype: 'application/pdf', originalname: 'a.html' }, cb);
    expect(cb).toHaveBeenCalledWith(null, true);
    expect(name('application/pdf')).toMatch(/\.pdf$/);
  });
  it('html не проходит', () => {
    const cb = jest.fn();
    photoUploadMulterOptions.fileFilter({}, { mimetype: 'text/html', originalname: 'a.pdf' }, cb);
    expect(cb.mock.calls[0][1]).toBe(false);
  });
});

describe('чертежи (purpose=drawing)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const o = require('./image-upload.options');
  const run = (name: string, purpose = 'drawing', mimetype = 'application/octet-stream') => {
    const cb = jest.fn();
    o.photoUploadMulterOptions.fileFilter({ query: { purpose } }, { mimetype, originalname: name }, cb);
    return cb.mock.calls[0];
  };
  it('pdf/dwg/dxf проходят, лимит 50 МБ', () => {
    for (const n of ['a.pdf', 'a.DWG', 'a.dxf']) expect(run(n)[1]).toBe(true);
    expect(o.photoUploadMulterOptions.limits.fileSize).toBe(50 * 1024 * 1024);
  });
  it('svg и exe — 400; без purpose=drawing dwg не принимается', () => {
    expect(run('a.svg', 'drawing', 'image/svg+xml')[1]).toBe(false);
    expect(run('a.exe')[1]).toBe(false);
    expect(run('a.dwg', 'showcase')[1]).toBe(false);
  });
  it('сигнатуры', () => {
    expect(o.drawingSignatureOk('.pdf', Buffer.from('%PDF-1.7'))).toBe(true);
    expect(o.drawingSignatureOk('.pdf', Buffer.from('MZ\x90'))).toBe(false);
    expect(o.drawingSignatureOk('.dwg', Buffer.from('AC1027'))).toBe(true);
    expect(o.drawingSignatureOk('.dxf', Buffer.from('  0\r\nSECTION'))).toBe(true);
    expect(o.drawingSignatureOk('.dxf', Buffer.from('hello'))).toBe(false);
  });
});
