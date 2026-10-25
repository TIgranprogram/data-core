import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { bundleFile, createBundleRequest, isBundleName, listBundles, readBundleStatus } from './bundle';

describe('переносной пакет', () => {
  let root: string; let bundles: string; let req: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'bd-'));
    bundles = path.join(root, 'bundles'); req = path.join(root, 'req');
    mkdirSync(bundles); mkdirSync(req);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const status = (o: object) => writeFileSync(path.join(req, 'status.json'), JSON.stringify(o));

  it('имя: только строгий формат', () => {
    expect(isBundleName('datacore-bundle-2026-10-25_031500.tar.gz')).toBe(true);
    for (const s of ['../x.tar.gz', 'datacore-bundle-../a.tar.gz', 'datacore-bundle-a/b.tar.gz', 'datacore-bundle-a.tar.gz.sha256', 'x.tar.gz', '', undefined]) expect(isBundleName(s)).toBe(false);
  });
  it('список: новые сверху, мусор и sha256 пропущены, нет папки — null', async () => {
    writeFileSync(path.join(bundles, 'datacore-bundle-a.tar.gz'), '123');
    writeFileSync(path.join(bundles, 'datacore-bundle-a.tar.gz.sha256'), 'x');
    writeFileSync(path.join(bundles, 'bundle.log'), 'x');
    const l = await listBundles(bundles);
    expect(l).toHaveLength(1);
    expect(l![0]).toMatchObject({ name: 'datacore-bundle-a.tar.gz', bytes: 3 });
    expect(await listBundles(path.join(root, 'nope'))).toBeNull();
  });
  it('файл: симлинк и каталог не отдаются', async () => {
    writeFileSync(path.join(bundles, 'datacore-bundle-a.tar.gz'), '1');
    mkdirSync(path.join(bundles, 'datacore-bundle-d.tar.gz'));
    try { symlinkSync(path.join(bundles, 'datacore-bundle-a.tar.gz'), path.join(bundles, 'datacore-bundle-l.tar.gz')); } catch { /* нет прав на симлинки (Windows) */ }
    expect(await bundleFile(bundles, 'datacore-bundle-a.tar.gz')).toMatchObject({ bytes: 1 });
    expect(await bundleFile(bundles, 'datacore-bundle-d.tar.gz')).toBeNull();
    expect(await bundleFile(bundles, 'datacore-bundle-l.tar.gz')).toBeNull();
    expect(await bundleFile(bundles, '../etc')).toBeNull();
  });
  it('статус: нет файла — idle; done; запрос без запуска — queued; битый JSON — idle', async () => {
    expect((await readBundleStatus(req)).state).toBe('idle');
    status({ state: 'done', file: 'datacore-bundle-a.tar.gz', bytes: 5, secret: 'x' });
    const done = await readBundleStatus(req);
    expect(done).toMatchObject({ state: 'done', bytes: 5 });
    expect(done).not.toHaveProperty('secret');
    writeFileSync(path.join(req, 'request'), '');
    expect((await readBundleStatus(req)).state).toBe('queued');
    rmSync(path.join(req, 'request'));
    writeFileSync(path.join(req, 'status.json'), '{oops');
    expect((await readBundleStatus(req)).state).toBe('idle');
  });
  it('статус: running дольше 6 часов — failed', async () => {
    status({ state: 'running', startedAt: new Date(Date.now() - 7 * 3600e3).toISOString() });
    expect((await readBundleStatus(req)).state).toBe('failed');
    status({ state: 'running', startedAt: new Date().toISOString() });
    expect((await readBundleStatus(req)).state).toBe('running');
  });
  it('запрос: создаётся, повтор и идущая сборка — busy (409)', async () => {
    expect(await createBundleRequest(req)).toBe('ok');
    if (process.platform !== 'win32') expect(statSync(path.join(req, 'request')).mode & 0o777).toBe(0o666);
    expect(await createBundleRequest(req)).toBe('busy');
    rmSync(path.join(req, 'request'));
    status({ state: 'running', startedAt: new Date().toISOString() });
    expect(await createBundleRequest(req)).toBe('busy');
    status({ state: 'failed' });
    expect(await createBundleRequest(req)).toBe('ok');
  });
});
