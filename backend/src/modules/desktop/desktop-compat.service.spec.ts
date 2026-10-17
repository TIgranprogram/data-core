import { DesktopCompatService } from './desktop-compat.service';

describe('DesktopCompatService (TZD-40)', () => {
  let service: DesktopCompatService;

  const KEYS = [
    'DESKTOP_MIN_VERSION',
    'DESKTOP_RECOMMENDED_VERSION',
    'DESKTOP_DOWNLOAD_URL',
    'APP_VERSION',
  ] as const;

  const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    service = new DesktopCompatService();
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('возвращает fail-open контракт без env (no banner)', () => {
    const info = service.compat();
    expect(info).toEqual({
      minDesktopVersion: '0.0.0',
      recommendedDesktopVersion: '0.0.0',
      downloadUrl: '/downloads/kppdf-desktop-setup.zip',
      serverBuildId: 'unknown',
    });
  });

  it('читает все поля из env', () => {
    process.env.DESKTOP_MIN_VERSION = '0.5.0';
    process.env.DESKTOP_RECOMMENDED_VERSION = '0.5.1';
    process.env.DESKTOP_DOWNLOAD_URL =
      'https://kppdf-crm.ru/downloads/kppdf-desktop-setup.exe';
    process.env.APP_VERSION = 'a966e424';

    expect(service.compat()).toEqual({
      minDesktopVersion: '0.5.0',
      recommendedDesktopVersion: '0.5.1',
      downloadUrl: 'https://kppdf-crm.ru/downloads/kppdf-desktop-setup.exe',
      serverBuildId: 'a966e424',
    });
  });

  it('пустая строка env = не задано (fail-open)', () => {
    process.env.DESKTOP_MIN_VERSION = '   ';
    process.env.DESKTOP_RECOMMENDED_VERSION = '';
    const info = service.compat();
    expect(info.minDesktopVersion).toBe('0.0.0');
    expect(info.recommendedDesktopVersion).toBe('0.0.0');
  });
});
