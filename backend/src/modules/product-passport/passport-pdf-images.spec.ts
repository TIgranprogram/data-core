import { mkdtemp, rm, writeFile, unlink } from 'fs/promises';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Types } from 'mongoose';
import sharp from 'sharp';
import { PassportPdfService } from './passport-pdf.service';
import { ProductPassportService } from './product-passport.service';
import { readPassportImage, unreadableRequiredImages } from './passport-image-files';
import { renderPassportPdfV2, type PdfV2Input } from './passport-pdf-v2';
import PDFDocument from 'pdfkit';
import * as dimensionImage from './passport-dimension-image';

describe('C086: обязательный рисунок должен читаться при выпуске и печати', () => {
  let dir: string;
  let png: Buffer;
  const previousDir = process.env.UPLOAD_DIR;
  const photoId = new Types.ObjectId();
  const overviewId = new Types.ObjectId();
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'passport-images-'));
    process.env.UPLOAD_DIR = dir;
    png = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#cc7722' } }).png().toBuffer();
    await writeFile(join(dir, 'good.png'), png);
    await writeFile(join(dir, 'broken.png'), 'not an image');
  });
  afterAll(async () => {
    if (previousDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  const make = (file: string, required = 'dimensions') => {
    const images = [{ kind: 'dimensions', photoId }, { kind: 'overview', photoId: overviewId }];
    const db = { collection: () => ({ find: () => ({ toArray: async () => [{ _id: photoId, storageUrl: '/uploads/' + file }, { _id: overviewId, storageUrl: '/uploads/good.png' }] }) }) };
    const passports = {
      effectiveImages: async () => images,
      installs: async () => new Map(),
      categoryRules: async () => new Map([['BLG', { requiredImages: required }]]),
    };
    const svc = new PassportPdfService(passports as never, { forPdf: async () => ({}) } as never, db as never);
    Object.assign(svc, { orgOf: async () => ({ orgIn: {}, asset: () => undefined }), styleOf: async () => ({}), defectImages: async () => ({}), log: { warn: jest.fn() } });
    const input = (status = 'issued', drawingLayout?: number) => (svc as unknown as { input(p: object, opts: object): Promise<PdfV2Input> }).input({ passportCategory: 'BLG', status, textSnapshot: { sections: [], drawingLayout } }, {});
    return { db, images, passports, svc, input };
  };

  it.each(['missing.png', 'broken.png'])('есть kind, но файл %s: PDF отклоняется с назначением рисунка', async (name) => {
    const { input, db, images } = make(name);
    await expect(input()).rejects.toThrow('Чертёж с размерами');
    expect(await unreadableRequiredImages(db as never, images, ['dimensions'])).toEqual(['dimensions']);
  });
  it('обычный PNG декодируется для PDF и проходит проверку выпуска', async () => {
    const { input, db, images } = make('good.png');
    const result = await input();
    expect(result.images.dimensions).toHaveLength(1);
    expect((await sharp(result.images.dimensions![0].buf).metadata()).format).toBe('jpeg');
    expect(await unreadableRequiredImages(db as never, images, ['dimensions'])).toEqual([]);
    const pdf = await renderPassportPdfV2(result);
    expect(pdf.toString('latin1')).toContain('/Subtype /Image');
  });
  it('новая обрезка только у черновика; выпущенный, аннулированный и старый паспорт печатаются прежним способом', async () => {
    const spy = jest.spyOn(dimensionImage, 'prepareDimensionImage');
    try {
      const { input } = make('good.png');
      for (const status of ['issued', 'annulled', '']) await input(status);
      expect(spy).not.toHaveBeenCalled();
      await input('draft');
      expect(spy).toHaveBeenCalledTimes(1);
      await input('issued', 2);
      await input('annulled', 2);
      expect(spy).toHaveBeenCalledTimes(3);
    } finally { spy.mockRestore(); }
  });
  it('необязательный отсутствующий файл не блокирует PDF', async () => {
    const { input } = make('missing.png', '');
    await expect(input()).resolves.toMatchObject({ images: { dimensions: [] } });
  });
  it('после загрузки файла повторная печать работает без перезапуска (не кэшируем ошибку)', async () => {
    const { input } = make('restored.png');
    await expect(input()).rejects.toThrow('Чертёж с размерами');
    await writeFile(join(dir, 'restored.png'), png);
    expect((await input()).images.dimensions).toHaveLength(1);
  });
  it('readiness выпуска отвергает битую ссылку, но принимает загруженный PNG', async () => {
    for (const file of ['missing.png', 'good.png']) {
      const { db, passports } = make(file);
      const svc = Object.create(ProductPassportService.prototype) as ProductPassportService;
      Object.assign(svc, passports, { connection: { db }, choiceMissing: async () => [], withSchemes: (doc: object) => doc });
      const missing = await svc.readiness({ passportCategory: 'BLG', images: [] });
      expect(missing.some((m) => m.key === 'img_dimensions')).toBe(file === 'missing.png');
      if (file === 'missing.png') expect(missing.find((m) => m.key === 'img_dimensions')?.label).toContain('Чертёж с размерами');
    }
  });
  it('check и выпуск требуют overview даже без записи в requiredImages; битая ссылка сразу в gaps', async () => {
    const { db, passports } = make('missing.png', '');
    const svc = Object.create(ProductPassportService.prototype) as ProductPassportService;
    const images = [{ kind: 'overview', photoId }];
    Object.assign(svc, passports, { connection: { db }, effectiveImages: async () => images, choiceMissing: async () => [], withSchemes: (doc: object) => doc, buildText: async () => null });
    const body = { passportCategory: 'BLG', images, mode: 'template' };
    const checked = await svc.check(body);
    expect(checked.requiredImages).toContain('overview');
    expect(checked.missing.find((m) => m.key === 'img_overview')?.label).toContain('Фото изделия');
    expect((await svc.readiness(body)).some((m) => m.key === 'img_overview')).toBe(true);
  });
  it('исправный файл декодируется один раз; удаление файла сбрасывает успешный кэш', async () => {
    await writeFile(join(dir, 'cache.png'), png);
    const read = jest.spyOn(fs, 'readFile');
    try {
      expect(await readPassportImage('/uploads/cache.png')).toBeTruthy();
      expect(await readPassportImage('/uploads/cache.png')).toBeTruthy();
      expect(read.mock.calls.filter(([path]) => String(path) === join(dir, 'cache.png'))).toHaveLength(1);
      await unlink(join(dir, 'cache.png'));
      await expect(readPassportImage('/uploads/cache.png')).rejects.toThrow();
      await writeFile(join(dir, 'cache.png'), png);
      expect(await readPassportImage('/uploads/cache.png')).toBeTruthy();
    } finally { read.mockRestore(); }
  });
  it('предпросмотр без рисунка остаётся доступен: рамка с назначением и ЧЕРНОВИК в реальном PDF', async () => {
    const { input } = make('missing.png');
    const draft = await input('draft');
    expect(draft.missingImages).toEqual([{ kind: 'dimensions', label: 'Чертёж с размерами' }]);
    expect(draft.watermark).toBe('ЧЕРНОВИК');
    const texts = jest.spyOn(PDFDocument.prototype, 'text');
    const frames = jest.spyOn(PDFDocument.prototype, 'rect');
    try {
      const pdf = await renderPassportPdfV2(draft);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(texts.mock.calls.some(([text]) => text === 'Чертёж с размерами')).toBe(true);
      expect(texts.mock.calls.some(([text]) => text === 'ЧЕРНОВИК')).toBe(true);
      expect(texts.mock.calls.some(([text]) => String(text).includes('Рисунок не загружен или файл не читается'))).toBe(true);
      expect(frames.mock.calls.some((args) => args[3] === 110)).toBe(true);
      if (process.env.PDFV2_OUT) await writeFile(join(process.env.PDFV2_OUT, 'draft-missing-images.pdf'), pdf);
    } finally { texts.mockRestore(); frames.mockRestore(); }
  });
});
