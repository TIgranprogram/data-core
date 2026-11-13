import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Types } from 'mongoose';
import { PdmFilesService, type PdmFileInput } from './pdm-files.service';
import { HttpException, NotFoundException } from '@nestjs/common';
import { assertPdmContent, pdmRel, pdmTicketUrl, pdmUrl, safeSegment } from './pdm-paths';

const PDF = Buffer.from('%PDF-1.4\nтест');
const DXF = Buffer.from('  0\r\nSECTION\r\n  2\r\nHEADER\r\n');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('pdm-paths', () => {
  it('путь строится из обозначения, версии и имени', () => {
    expect(pdmRel('0000.0000.0019', 3, '0000.0000.0019.DXF')).toBe('pdm/0000.0000.0019/v3/0000.0000.0019.DXF');
    expect(pdmRel('СК08.080.ПРШ', 1, 'СК08.080.ПРШ.pdf')).toBe('pdm/СК08.080.ПРШ/v1/СК08.080.ПРШ.pdf');
  });
  it.each(['../x', '..', 'a/b', 'a\\b', '.hidden', 'a..b', '', 'a b', 'a%2e', 'a\0b'])('отклоняет «%s»', (v) => {
    expect(() => safeSegment(v, 'обозначение')).toThrow(BadRequestException);
  });
  it('версия — целое неотрицательное', () => {
    expect(() => pdmRel('A1', -1, 'a.pdf')).toThrow(BadRequestException);
    expect(() => pdmRel('A1', 1.5, 'a.pdf')).toThrow(BadRequestException);
  });
  it('ссылка — через API по id, не путь на диске (C109)', () => {
    expect(pdmUrl('65a1b2c3d4e5f60718293a4b')).toBe('/api/pdm-files/65a1b2c3d4e5f60718293a4b/download');
    expect(pdmTicketUrl('65a1b2c3d4e5f60718293a4b', 'ab12')).toBe('/api/pdm-files/65a1b2c3d4e5f60718293a4b/file?t=ab12');
  });
  it('сигнатура и расширение', () => {
    expect(() => assertPdmContent('pdf', 'a.pdf', PDF)).not.toThrow();
    expect(() => assertPdmContent('dxf', 'a.dxf', DXF)).not.toThrow();
    expect(() => assertPdmContent('pdf', 'a.pdf', Buffer.from('<html>'))).toThrow(BadRequestException);
    expect(() => assertPdmContent('dxf', 'a.pdf', DXF)).toThrow(BadRequestException);
    expect(() => assertPdmContent('assembly', 'a.pdf', Buffer.alloc(0))).toThrow(BadRequestException);
  });
});

/** Модель-заглушка: хранит записи в памяти, понимает только запросы, которые делает сервис. */
function fakeModel() {
  const rows: Array<Record<string, any>> = [];
  const match = (r: Record<string, any>, f: Record<string, any>) => Object.entries(f).every(([k, v]) => (k === 'deletedAt' ? (r.deletedAt ?? null) === v : String(r[k]) === String(v)));
  const q = (list: any) => ({ select: () => q(list), sort: () => q(list), lean: () => q(list), exec: async () => list });
  return {
    rows,
    findOne: (f: any) => q(rows.filter((r) => match(r, f)).sort((a, b) => b.pdmVersion - a.pdmVersion)[0] ?? null),
    exists: async (f: any) => rows.some((r) => match(r, f)),
    updateMany: (f: any, u: any) => ({ exec: async () => rows.filter((r) => match(r, f)).forEach((r) => Object.assign(r, u.$set)) }),
    create: async (d: any) => { const r = { _id: new Types.ObjectId(), ...d }; rows.push(r); return r; },
  };
}

describe('PdmFilesService.save', () => {
  const root = mkdtempSync(join(tmpdir(), 'pdm-'));
  const prev = process.env.UPLOAD_DIR;
  beforeAll(() => { process.env.UPLOAD_DIR = root; });
  afterAll(() => { process.env.UPLOAD_DIR = prev; rmSync(root, { recursive: true, force: true }); });

  const meta = (extra: Partial<PdmFileInput> = {}): PdmFileInput => ({ ownerKind: 'material', ownerId: String(new Types.ObjectId()), designation: '0000.0000.0019', docKind: 'dxf', name: '0000.0000.0019.DXF', pdmVersion: 1, ...extra });

  it('пишет файл, потом повтор — stored:false', async () => {
    const m = fakeModel(); const s = new PdmFilesService(m as any);
    const a = await s.save(meta({ sha256: sha(DXF) }), DXF);
    expect(a.stored).toBe(true);
    expect(existsSync(join(root, 'pdm', '0000.0000.0019', 'v1', '0000.0000.0019.DXF'))).toBe(true);
    const b = await s.save(meta({ sha256: sha(DXF) }), DXF);
    expect(b).toEqual({ id: a.id, stored: false });
    expect(m.rows).toHaveLength(1);
  });

  it('чужая сумма — 400, файл не пишется', async () => {
    const m = fakeModel(); const s = new PdmFilesService(m as any);
    await expect(s.save(meta({ designation: 'A.1', sha256: 'f'.repeat(64) }), DXF)).rejects.toThrow(BadRequestException);
    expect(m.rows).toHaveLength(0);
    expect(existsSync(join(root, 'pdm', 'A.1'))).toBe(false);
  });

  it('путь с «../» — 400', async () => {
    const s = new PdmFilesService(fakeModel() as any);
    await expect(s.save(meta({ designation: '../evil' }), DXF)).rejects.toThrow(BadRequestException);
    await expect(s.save(meta({ name: '..\\x.DXF' }), DXF)).rejects.toThrow(BadRequestException);
  });

  it('новая версия становится текущей, старая — нет', async () => {
    const m = fakeModel(); const s = new PdmFilesService(m as any);
    const v2 = Buffer.concat([DXF, Buffer.from('  0\r\nEOF\r\n')]);
    await s.save(meta({ designation: 'B.2', pdmVersion: 1 }), DXF);
    await s.save(meta({ designation: 'B.2', pdmVersion: 2 }), v2);
    expect(m.rows.map((r) => [r.pdmVersion, r.isCurrent])).toEqual([[1, false], [2, true]]);
    await s.save(meta({ designation: 'B.2', pdmVersion: 0 }), Buffer.concat([DXF, Buffer.from('x')]));
    expect(m.rows.find((r) => r.pdmVersion === 0)!.isCurrent).toBe(false);
  });

  it('та же версия с другим содержимым — 409', async () => {
    const s = new PdmFilesService(fakeModel() as any);
    await s.save(meta({ designation: 'C.3' }), DXF);
    await expect(s.save(meta({ designation: 'C.3' }), Buffer.concat([DXF, Buffer.from('y')]))).rejects.toThrow(ConflictException);
  });

  it('неизвестный владелец и вид — 400', async () => {
    const s = new PdmFilesService(fakeModel() as any);
    await expect(s.save(meta({ ownerKind: 'order' }), DXF)).rejects.toThrow(BadRequestException);
    await expect(s.save(meta({ docKind: 'exe' }), DXF)).rejects.toThrow(BadRequestException);
  });

  it('GET: текущие файлы с версиями', async () => {
    const found = [
      { _id: 1, designation: 'D', docKind: 'pdf', pdmVersion: 2, isCurrent: true, path: 'pdm/D/v2/D.pdf' },
      { _id: 2, designation: 'D', docKind: 'pdf', pdmVersion: 1, isCurrent: false, path: 'pdm/D/v1/D.pdf' },
    ];
    const model = { find: () => ({ sort: () => ({ lean: () => ({ exec: async () => found }) }) }) };
    const r = await new PdmFilesService(model as any).list('product', String(new Types.ObjectId()));
    expect(r.total).toBe(1);
    expect(r.items[0]).toMatchObject({ pdmVersion: 2, url: '/api/pdm-files/1/download' });
    expect((r.items[0] as any).versions.map((v: any) => v.pdmVersion)).toEqual([2, 1]);
    expect((r.items[0] as any).path).toBeUndefined();
    await expect(new PdmFilesService(model as any).list('order', 'x')).rejects.toThrow(BadRequestException);
  });

  it('скачивание по тикету: один раз, только свой файл (C109)', async () => {
    const m = fakeModel(); const s = new PdmFilesService(m as any);
    const a = await s.save(meta({ designation: 'E.5' }), DXF);
    const b = await s.save(meta({ designation: 'F.6' }), DXF);
    const t = await s.ticket(a.id, 'u1');
    expect(t.url).toBe(`/api/pdm-files/${a.id}/file?t=${t.ticket}`);
    const f = await s.fileByTicket(a.id, t.ticket);
    expect(f).toMatchObject({ id: a.id, name: '0000.0000.0019.DXF', size: DXF.length });
    await expect(s.fileByTicket(a.id, t.ticket)).rejects.toThrow(HttpException); // повтор
    const t2 = await s.ticket(a.id, 'u1');
    await expect(s.fileByTicket(b.id, t2.ticket)).rejects.toThrow(HttpException); // чужой файл
    await expect(s.fileByTicket(a.id, 'нет-такого')).rejects.toThrow(HttpException);
    await expect(s.ticket('не-id', 'u1')).rejects.toThrow(NotFoundException);
    await expect(s.ticket(String(new Types.ObjectId()), 'u1')).rejects.toThrow(NotFoundException);
  });
});
