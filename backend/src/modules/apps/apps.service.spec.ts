import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { AppsService, compareVersions, PDM_LOADER_FILE, VERSION_RE } from './apps.service';

describe('AppsService', () => {
  let root: string;
  const prev = process.env.UPLOAD_DIR;
  const put = (version: string, content = 'MZ', meta?: object) => {
    const dir = join(root, 'apps', 'pdm-loader', version);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, PDM_LOADER_FILE), content);
    if (meta) writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
  };
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'apps-')); process.env.UPLOAD_DIR = root; });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); if (prev === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = prev; });

  it('нет файла — 404 «Приложение ещё не выложено»', async () => {
    const s = new AppsService();
    await expect(s.info()).rejects.toThrow(NotFoundException);
    await expect(s.info()).rejects.toThrow('Приложение ещё не выложено');
    await expect(s.open()).rejects.toThrow(NotFoundException);
  });

  it('берётся старшая версия по числам (1.10.0 > 1.9.0), папки без файла и с чужим именем пропускаются', async () => {
    put('1.9.0'); put('1.10.0', 'newer');
    mkdirSync(join(root, 'apps', 'pdm-loader', '2.0.0'), { recursive: true }); // без файла
    put('1.0'); // имя не по шаблону
    const info = await new AppsService().info();
    expect(info.version).toBe('1.10.0');
    expect(info.size).toBe(5);
    expect(info.sha256).toBe(createHash('sha256').update('newer').digest('hex'));
    expect(new Date(info.uploadedAt).getTime()).not.toBeNaN();
  });

  it('meta.json: sha256 и дата берутся из него', async () => {
    const sha = 'a'.repeat(64);
    put('1.0.0', 'MZ', { sha256: sha, uploadedAt: '2026-11-09T10:00:00.000Z' });
    expect(await new AppsService().info()).toMatchObject({ version: '1.0.0', sha256: sha, uploadedAt: '2026-11-09T10:00:00.000Z' });
  });

  it('open отдаёт поток и размер', async () => {
    put('1.0.1', 'abc');
    const { stream, size } = await new AppsService().open();
    expect(size).toBe(3);
    stream.destroy();
  });

  it('версия по шаблону: только три числа', () => {
    for (const v of ['1.0.0', '10.20.30']) expect(VERSION_RE.test(v)).toBe(true);
    for (const v of ['1.0', '1.0.0.0', '../1.0.0', '1.0.0/..', 'v1.0.0', '1.0.0-beta', ''] ) expect(VERSION_RE.test(v)).toBe(false);
    expect(['1.9.0', '1.10.0', '1.2.3'].sort(compareVersions)).toEqual(['1.2.3', '1.9.0', '1.10.0']);
  });
});
