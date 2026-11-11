import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { assertPdf, presentPrint, readPrintFile, storePrintPdf } from './passport-print-file';

describe('файл печати паспорта', () => {
  let dir = '';
  const prev = process.env.UPLOAD_DIR;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pp-file-'));
    process.env.UPLOAD_DIR = dir;
  });
  afterAll(async () => {
    if (prev === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = prev;
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('нет файла — источник app, отдача пустая', async () => {
    expect(presentPrint({})).toEqual({ printSource: 'app', printFile: { name: null, hasFile: false } });
    expect(await readPrintFile({})).toBeNull();
  });

  it('прикреплённый PDF отдаётся байтами, путь в ответ не входит', async () => {
    const stored = await storePrintPdf(Buffer.from('%PDF-1.4 x'), 'Мой паспорт.pdf');
    expect(stored.path.startsWith('/uploads/passport/')).toBe(true);
    const view = presentPrint({ printFile: stored });
    expect(view).toEqual({ printSource: 'file', printFile: { name: 'Мой паспорт.pdf', hasFile: true } });
    expect(JSON.stringify(view)).not.toContain('/uploads/');
    const got = await readPrintFile({ printFile: stored });
    expect(got?.buf.toString()).toContain('%PDF');
    expect(got?.filename).toBe('Мой паспорт.pdf');
  });

  it('не PDF и пустой файл — 400', () => {
    expect(() => assertPdf(undefined)).toThrow('Прикрепите PDF');
    expect(() => assertPdf({ buffer: Buffer.from('hello'), mimetype: 'text/plain', size: 5 })).toThrow(BadRequestException);
    expect(() => assertPdf({ buffer: Buffer.from('not a pdf'), mimetype: 'application/pdf', size: 9 })).toThrow('Нужен файл PDF');
  });

  it('путь записан, файла на диске нет — 400', async () => {
    await expect(readPrintFile({ printFile: { path: '/uploads/passport/net-fayla.pdf', originalName: 'a.pdf' } })).rejects.toThrow('не найден');
  });
});
