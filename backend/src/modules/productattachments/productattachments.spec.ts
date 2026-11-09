import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { attachmentMaxBytes, extOf, isAllowedExt, signatureOk } from './attachment-formats';
import { capacityError, capacityLimits } from './attachment-capacity';
import { contentDisposition, isAttachmentsUrl, parseRange, resolveInside, safeDownloadName, storedRel } from './attachment-paths';
import { DownloadTickets, TICKET_TTL_MS } from './download-tickets';
import { ProductAttachmentFileController, ProductAttachmentsController } from './productattachments.controller';
import { DEFAULT_TYPES, ProductAttachmentsService } from './productattachments.service';

const B = (...x: number[]) => Buffer.from(x);
const T = (s: string) => Buffer.from(s, 'latin1');
const pad = (b: Buffer, n = 100) => Buffer.concat([b, Buffer.alloc(n)]);

describe('вложения: расширения', () => {
  it('берётся последнее расширение', () => {
    expect(extOf('a.pdf.exe')).toBe('exe');
    expect(extOf('Чертёж.DWG')).toBe('dwg');
    expect(extOf('noext')).toBe('');
  });
  it('белый список: нужные форматы есть, исполняемые — нет', () => {
    for (const e of ['pdf', 'docx', 'dwg', 'dxf', 'step', 'stp', 'igs', 'stl', 'sldprt', 'sldasm', 'ipt', 'iam', '3dm', 'f3d', 'skp', '3ds', 'fbx', 'zip', 'rar', '7z', 'cdr', 'ai', 'svg', 'tif', 'webp']) expect(isAllowedExt(e)).toBe(true);
    for (const e of ['exe', 'dll', 'bat', 'cmd', 'ps1', 'sh', 'js', 'vbs', 'msi', 'jar', 'com', 'scr', 'html', 'htm', 'php', 'gif', '', 'constructor', 'toString']) expect(isAllowedExt(e)).toBe(false);
  });
  it('лимит размера: 512 МБ по умолчанию, настраивается', () => {
    expect(attachmentMaxBytes({})).toBe(512 * 1024 * 1024);
    expect(attachmentMaxBytes({ ATTACHMENT_MAX_BYTES: '1000' } as never)).toBe(1000);
    expect(attachmentMaxBytes({ ATTACHMENT_MAX_BYTES: 'abc' } as never)).toBe(512 * 1024 * 1024);
  });
});

describe('вложения: сигнатуры', () => {
  const exe = pad(T('MZ\x90\x00'));
  it('настоящие файлы проходят', () => {
    expect(signatureOk('pdf', pad(T('%PDF-1.7')), 1000)).toBe(true);
    expect(signatureOk('dwg', pad(T('AC1027')), 1000)).toBe(true);
    expect(signatureOk('dxf', T('  0\r\nSECTION\r\n  2\r\nHEADER'), 100)).toBe(true);
    expect(signatureOk('png', pad(B(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 1000)).toBe(true);
    expect(signatureOk('jpg', pad(B(0xff, 0xd8, 0xff, 0xe0)), 1000)).toBe(true);
    expect(signatureOk('docx', pad(B(0x50, 0x4b, 0x03, 0x04)), 1000)).toBe(true);
    expect(signatureOk('xls', pad(B(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)), 1000)).toBe(true);
    expect(signatureOk('7z', pad(B(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)), 1000)).toBe(true);
    expect(signatureOk('rar', pad(T('Rar!\x1a\x07\x00')), 1000)).toBe(true);
    expect(signatureOk('step', T('ISO-10303-21;\nHEADER;'), 100)).toBe(true);
    expect(signatureOk('fbx', pad(T('Kaydara FBX Binary  \x00')), 1000)).toBe(true);
    expect(signatureOk('skp', pad(B(0xff, 0xfe, 0xff, 0x0e)), 1000)).toBe(true);
    expect(signatureOk('3dm', pad(T('3D Geometry File Format ')), 1000)).toBe(true);
    expect(signatureOk('ai', pad(T('%!PS-Adobe')), 1000)).toBe(true);
    expect(signatureOk('cdr', pad(Buffer.concat([T('RIFF'), B(1, 2, 3, 4), T('CDRX')])), 1000)).toBe(true);
    expect(signatureOk('webp', pad(Buffer.concat([T('RIFF'), B(1, 2, 3, 4), T('WEBP')])), 1000)).toBe(true);
  });
  it('exe под видом .pdf и других форматов — отказ', () => {
    for (const e of ['pdf', 'png', 'zip', 'docx', 'dwg', 'txt', 'sldasm', 'sldprt', 'obj', 'step']) expect(signatureOk(e, exe, 1000)).toBe(false);
    expect(signatureOk('sldasm', pad(B(0x7f, 0x45, 0x4c, 0x46)), 1000)).toBe(false);
    expect(signatureOk('txt', T('#!/bin/sh\necho'), 100)).toBe(false);
    expect(signatureOk('svg', T('<html><script>alert(1)</script>'), 100)).toBe(false);
  });
  it('чужое содержимое при верном расширении — отказ', () => {
    expect(signatureOk('pdf', pad(T('PK\x03\x04')), 1000)).toBe(false);
    expect(signatureOk('png', pad(T('%PDF-1.4')), 1000)).toBe(false);
    expect(signatureOk('dwg', pad(T('hello')), 1000)).toBe(false);
    expect(signatureOk('iges', T('short'), 5)).toBe(false);
    expect(signatureOk('exe', pad(T('MZ')), 100)).toBe(false);
  });
  it('текстовые форматы: нулевой байт — отказ, UTF-16 — можно', () => {
    expect(signatureOk('csv', T('a;b\n1;2'), 10)).toBe(true);
    expect(signatureOk('obj', pad(T('v 0 0 0\n'), 3), 20)).toBe(false);
    expect(signatureOk('txt', B(0xff, 0xfe, 0x41, 0x00), 4)).toBe(true);
  });
  it('STL: ascii и бинарный по размеру', () => {
    expect(signatureOk('stl', T('solid cube\nfacet'), 500)).toBe(true);
    const bin = Buffer.alloc(184); bin.writeUInt32LE(2, 80);
    expect(signatureOk('stl', bin, 84 + 100)).toBe(true);
    expect(signatureOk('stl', bin, 84 + 99)).toBe(false);
  });
  it('IGES: 73-й символ первой строки — S', () => {
    const line = 'x'.repeat(72) + 'S      1\n';
    expect(signatureOk('igs', T(line), line.length)).toBe(true);
    expect(signatureOk('igs', T('x'.repeat(80)), 80)).toBe(false);
  });
});

describe('вложения: пути', () => {
  const pid = 'a'.repeat(24);
  const tid = 'b'.repeat(24);
  it('путь собирает сервер из проверенных id', () => {
    const rel = storedRel(pid, tid, 'pdf', 'uuid');
    expect(rel).toBe(`attachments/${pid}/${tid}/uuid.pdf`);
    expect(rel).not.toContain('..');
  });
  it('id и расширение с «..» или слэшами — ошибка', () => {
    expect(() => storedRel('../../etc', tid, 'pdf')).toThrow();
    expect(() => storedRel(pid, `${tid.slice(0, 20)}/..x`, 'pdf')).toThrow();
    expect(() => storedRel(pid, tid, '../x')).toThrow();
    expect(() => storedRel(pid, tid, 'p/df')).toThrow();
  });
  it('resolveInside не выпускает за корень', () => {
    expect(resolveInside('/srv/uploads', `attachments/${pid}/${tid}/f.pdf`)).toContain('attachments');
    expect(() => resolveInside('/srv/uploads', '../secret')).toThrow();
    expect(() => resolveInside('/srv/uploads', 'attachments/../../x')).toThrow();
    expect(() => resolveInside('/srv/uploads', '/etc/passwd')).toThrow();
  });
  it('публичная раздача: все обходы папки вложений закрыты', () => {
    for (const u of ['/uploads/attachments/a/b/c.pdf', '/uploads/Attachments/x', '/uploads/%61ttachments/x', '/uploads//attachments/x', '/uploads/x/../attachments/y', '/uploads\\attachments\\y', '/uploads/attachments', '/uploads/%2561ttachments/x', '/uploads/attachments/x?v=1', '/uploads/%E0%A4%A', '/uploads/apps/pdm-loader/1.0.0/DataCore.PdmLoader.exe', '/uploads/%61pps/x'])
      expect([u, isAttachmentsUrl(u)]).toEqual([u, true]);
    for (const u of ['/uploads/2026-11/a.jpg', '/uploads/drawing/a.pdf', '/uploads/attachments-old/a.jpg', '/api/products/1/attachments'])
      expect([u, isAttachmentsUrl(u)]).toEqual([u, false]);
  });
  it('имя для скачивания очищено', () => {
    expect(safeDownloadName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeDownloadName('a"b\r\nc:d.pdf')).toBe('a_b__c_d.pdf');
    expect(safeDownloadName('...')).toBe('file');
    expect(safeDownloadName('.hidden')).toBe('hidden');
    const cd = contentDisposition('Чертёж "1".dwg');
    expect(cd).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    expect(cd).not.toMatch(/[\r\n]/);
  });
  it('Range', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=0-999', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('bad');
    expect(parseRange('bytes=9-1', 100)).toBe('bad');
    expect(parseRange('items=1-2', 100)).toBe('bad');
  });
});

describe('вложения: тикеты и место', () => {
  it('тикет одноразовый и живёт 60 секунд', () => {
    let now = 1000;
    const t = new DownloadTickets(() => now);
    const a = t.issue('att1', 'u1');
    expect(t.consume(a.ticket, 'att1')).toEqual({ userId: 'u1' });
    expect(t.consume(a.ticket, 'att1')).toBeNull();
    const b = t.issue('att1', 'u1');
    now += TICKET_TTL_MS + 1;
    expect(t.consume(b.ticket, 'att1')).toBeNull();
    const c = t.issue('att1', 'u1');
    expect(t.consume(c.ticket, 'att2')).toBeNull(); // чужой файл
    expect(t.consume('', 'att1')).toBeNull();
  });
  it('место: запас 1 ГБ, потолок min(50 ГБ, 70 %)', () => {
    const GB = 1024 ** 3;
    const lim = capacityLimits({});
    expect(capacityError(0, 100 * GB, 0.5 * GB, lim)).toBeNull();
    expect(capacityError(0, 1.2 * GB, 0.5 * GB, lim)).toMatch(/не хватает места/);
    expect(capacityError(49.9 * GB, 500 * GB, 0.5 * GB, lim)).toMatch(/исчерпано/);
    expect(capacityError(10 * GB, 20 * GB, 12 * GB, lim)).toMatch(/исчерпано/); // 70 % от 30 = 21
  });
});

describe('вложения: права и сервис', () => {
  const roles = (proto: object, name: string) => new Reflector().get<string[]>(ROLES_KEY, (proto as Record<string, never>)[name]);
  it('загрузка — admin+manager, чтение — все, удаление и восстановление — только admin', () => {
    const p = ProductAttachmentsController.prototype;
    expect(roles(p, 'upload')).toEqual(['admin', 'manager']);
    expect(roles(p, 'remove')).toEqual(['admin']);
    expect(roles(p, 'restore')).toEqual(['admin']);
    expect(roles(p, 'list')).toEqual(expect.arrayContaining(['admin', 'manager', 'user']));
    expect(roles(p, 'ticket')).toEqual(expect.arrayContaining(['admin', 'manager', 'user']));
  });
  it('на каждом маршруте управления есть журнал', () => {
    const r = new Reflector();
    const p = ProductAttachmentsController.prototype;
    for (const m of ['upload', 'remove', 'restore'] as const) expect(r.get('auditAction', p[m])).toBeDefined();
    expect(ProductAttachmentFileController.prototype.file).toBeDefined();
  });
  it('виды по умолчанию заведены', () => expect(DEFAULT_TYPES).toContain('Чертежи'));

  const mk = (existsProduct: boolean, type: unknown) => {
    const svc = new ProductAttachmentsService(
      {} as never,
      { exists: async () => (existsProduct ? { _id: 1 } : null) } as never,
      { db: { collection: () => ({ findOne: async () => type }) } } as never,
    );
    return svc;
  };
  const oid = 'c'.repeat(24);
  it('assertTarget: нет изделия — 404, нет вида — 400, нечисловой id — отказ', async () => {
    await expect(mk(false, { name: 'x' }).assertTarget(oid, oid)).rejects.toThrow('Изделие не найдено');
    await expect(mk(true, null).assertTarget(oid, oid)).rejects.toThrow('Такого вида');
    await expect(mk(true, { name: 'x' }).assertTarget('../x', oid)).rejects.toThrow('Изделие не найдено');
    await expect(mk(true, { name: 'x' }).assertTarget(oid, '..')).rejects.toThrow('Выберите вид');
    await expect(mk(true, { name: 'Чертежи' }).assertTarget(oid, oid)).resolves.toBe('Чертежи');
  });
});
