import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { archiveName, backupDirs, backupStamps, backupTgz, isStamp, latestBackupDate, listBackups, parsePart } from './backups';

describe('резервные копии', () => {
  let root: string;
  const put = (dir: string, file: string, data: string) => {
    mkdirSync(path.join(root, dir), { recursive: true });
    writeFileSync(path.join(root, dir, file), data);
  };
  beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'bk-'));
    put('mongo-2026-10-24_030000', 'a.bson', '12345');
    put('mongo-2026-10-25_030000', 'a.bson', '123');
    put('uploads-2026-10-25_030000', 'p.jpg', '12');
    mkdirSync(path.join(root, 'mongo-bad'));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('stamp: только строгий формат', () => {
    expect(isStamp('2026-10-25_030000')).toBe(true);
    for (const s of ['../etc', '2026-10-25_03000', '2026-10-25_030000/..', '', undefined]) expect(isStamp(s)).toBe(false);
  });
  it('part', () => {
    expect(parsePart(undefined)).toBe('all');
    expect(parsePart('mongo')).toBe('mongo');
    expect(parsePart('x')).toBeNull();
  });
  it('список: новые сверху, фото может не быть, мусор пропущен', async () => {
    const l = await listBackups(root);
    expect(l!.map((i) => i.stamp)).toEqual(['2026-10-25_030000', '2026-10-24_030000']);
    expect(l![0]).toMatchObject({ mongoBytes: 3, uploadsBytes: 2, totalBytes: 5 });
    expect(l![1]).toMatchObject({ mongoBytes: 5, uploadsBytes: null, totalBytes: 5 });
  });
  it('нет папки — null', async () => {
    expect(await listBackups(path.join(root, 'nope'))).toBeNull();
  });
  it('папки для архива и имя', async () => {
    expect(await backupDirs(root, '2026-10-24_030000', 'all')).toHaveLength(1);
    expect(await backupDirs(root, '2026-10-25_030000', 'all')).toHaveLength(2);
    expect(await backupDirs(root, '2026-10-24_030000', 'uploads')).toHaveLength(0);
    expect(archiveName('2026-10-25_030000', 'mongo')).toBe('datacore-backup-2026-10-25_030000-mongo.zip');
    expect(archiveName('2026-10-25_030000', 'all')).toBe('datacore-backup-2026-10-25_030000.zip');
  });
  it('последняя копия: папки mongo- и архив второго сервера srv-erp-*.tgz', async () => {
    expect(await latestBackupDate(root)).toBe('2026-10-25T03:00:00');
    writeFileSync(path.join(root, 'srv-erp-20261031-1901.tgz'), 'x');
    expect(await latestBackupDate(root)).toBe('2026-10-31T19:01:00');
  });
  it('архив второго сервера в списке: один файл, скачивание целиком', async () => {
    const l = await listBackups(root);
    expect(l![0]).toMatchObject({ stamp: '2026-10-31_190100', single: true, uploadsBytes: null, totalBytes: 1 });
    expect(await backupTgz(root, '2026-10-31_190100')).toMatch(/srv-erp-20261031-1901\.tgz$/);
    expect(await backupTgz(root, '2026-10-25_030000')).toBeNull();
    expect(backupStamps(['mongo-2026-10-25_030000', 'srv-erp-20261031-1901.tgz', 'srv-erp-x.tgz']).size).toBe(2);
  });
});
