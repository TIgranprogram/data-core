import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SupplierItem } from './schemas/supplier-item.schema';
import { Organization } from '../organization/organization.schema';
import { SupplierCatalogService, checkSsrf } from './supplier-catalog.service';
import { assertPublicHost, createSafeFetch, dnsApi, hostAllowed, isPrivateIp } from './safe-fetch';

// ─── SSRF tests ────────────────────────────────────────────────────────────

describe('checkSsrf', () => {
  it('rejects localhost', () => {
    expect(() => checkSsrf('http://localhost/catalog')).toThrow(BadRequestException);
  });

  it('rejects 127.0.0.1', () => {
    expect(() => checkSsrf('http://127.0.0.1/catalog')).toThrow(BadRequestException);
  });

  it('rejects 10.0.0.1', () => {
    expect(() => checkSsrf('http://10.0.0.1/catalog')).toThrow(BadRequestException);
  });

  it('rejects 192.168.1.1', () => {
    expect(() => checkSsrf('http://192.168.1.1/catalog')).toThrow(BadRequestException);
  });

  it('rejects 172.16.0.1', () => {
    expect(() => checkSsrf('http://172.16.0.1/catalog')).toThrow(BadRequestException);
  });

  it('rejects 172.31.255.255', () => {
    expect(() => checkSsrf('http://172.31.255.255/catalog')).toThrow(BadRequestException);
  });

  it('allows external URL', () => {
    expect(() => checkSsrf('https://zaglushka.ru/catalog')).not.toThrow();
  });

  it('rejects link-local, CGNAT, 0/8 and IPv6 loopback', () => {
    for (const h of ['169.254.169.254', '100.64.0.1', '0.1.2.3', '[::1]', '[fd00::1]', '[::ffff:127.0.0.1]']) {
      expect(() => checkSsrf(`http://${h}/x`)).toThrow(BadRequestException);
    }
  });

  it('rejects non-http protocol', () => {
    expect(() => checkSsrf('ftp://external.com/catalog')).toThrow(BadRequestException);
  });
});

// ─── Service tests ────────────────────────────────────────────────────────

function makeMockModel() {
  const bulkWriteMock = jest.fn().mockResolvedValue({});
  const updateManyMock = jest.fn().mockResolvedValue({});
  const countDocumentsMock = jest.fn().mockResolvedValue(0);
  const aggregateMock = jest.fn().mockResolvedValue([]);
  const findMock = jest.fn().mockReturnValue({
    skip: () => ({ limit: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }) }),
  });

  return {
    bulkWrite: bulkWriteMock,
    updateMany: updateManyMock,
    countDocuments: countDocumentsMock,
    find: findMock,
    aggregate: aggregateMock,
    _aggregateMock: aggregateMock,
    _bulkWriteMock: bulkWriteMock,
    _updateManyMock: updateManyMock,
  };
}

function makeMockOrgModel(org: Record<string, unknown> | null) {
  return {
    findById: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(org) }) }),
    updateOne: jest.fn().mockResolvedValue({}),
  };
}

describe('SupplierCatalogService', () => {
  let service: SupplierCatalogService;
  let itemModel: ReturnType<typeof makeMockModel>;
  let orgModel: ReturnType<typeof makeMockOrgModel>;
  let tmpDir: string;

  const orgId = new Types.ObjectId().toString();
  const supplierId = new Types.ObjectId(orgId);

  function buildOrg(extra: Record<string, unknown> = {}) {
    return {
      _id: supplierId,
      name: 'Заглушка',
      catalogUrl: 'https://zaglushka.ru/catalog',
      ...extra,
    };
  }

  async function buildService(org: Record<string, unknown> | null) {
    itemModel = makeMockModel();
    orgModel = makeMockOrgModel(org);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc1-test-'));

    const module = await Test.createTestingModule({
      providers: [
        SupplierCatalogService,
        { provide: getModelToken(SupplierItem.name), useValue: itemModel },
        { provide: getModelToken(Organization.name), useValue: orgModel },
        { provide: getConnectionToken(), useValue: {} },
      ],
    }).compile();

    service = module.get(SupplierCatalogService);
    service.uploadsDir = tmpDir;
    return service;
  }

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws 409 when sync already running', async () => {
    await buildService(buildOrg());
    (service as unknown as { running: Set<string> }).running.add(orgId);
    await expect(service.startSync(orgId)).rejects.toThrow(ConflictException);
  });

  it('throws 404 when org not found', async () => {
    await buildService(null);
    await expect(service.startSync(orgId)).rejects.toThrow(NotFoundException);
  });

  it('throws 400 when no catalogUrl', async () => {
    await buildService(buildOrg({ catalogUrl: undefined }));
    await expect(service.startSync(orgId)).rejects.toThrow(BadRequestException);
  });

  it('upsert without duplicates: 3 unique items → 3 ops', async () => {
    await buildService(buildOrg());

    const items = [
      { vendorArticle: 'ART-1', name: 'Item 1', sourceUrl: 'https://zaglushka.ru/1', inStock: true },
      { vendorArticle: 'ART-2', name: 'Item 2', sourceUrl: 'https://zaglushka.ru/2', inStock: true },
      { vendorArticle: 'ART-3', name: 'Item 3', sourceUrl: 'https://zaglushka.ru/3', inStock: false },
    ];

    async function* fakeGen() {
      for (const it of items) yield it;
    }

    const adapterSpy = { fetchItems: jest.fn().mockReturnValue(fakeGen()), fetchRaw: jest.fn().mockResolvedValue(null) };
    jest.spyOn(service as never, 'resolveAdapter').mockReturnValue(adapterSpy as never);

    await (service as unknown as { runSyncBackground: (id: string, url: string) => Promise<void> })
      .runSyncBackground(orgId, 'https://zaglushka.ru/catalog');

    const calls = itemModel._bulkWriteMock.mock.calls as Array<[Array<unknown>]>;
    const allOps = calls.flatMap(([ops]) => ops);
    expect(allOps.length).toBe(3);
    const filters = allOps.map((op: unknown) => {
      const o = op as { updateOne: { filter: { vendorArticle: string } } };
      return o.updateOne.filter.vendorArticle;
    });
    expect(new Set(filters).size).toBe(3);
  });

  it('marks missing items active:false after sync', async () => {
    await buildService(buildOrg());

    async function* fakeGen2() {
      yield { vendorArticle: 'ART-X', name: 'Kept', sourceUrl: 'https://zaglushka.ru/x', inStock: true };
    }

    const adapterSpy2 = { fetchItems: jest.fn().mockReturnValue(fakeGen2()), fetchRaw: jest.fn().mockResolvedValue(null), complete: true, hosts: ['zaglushka.ru'] };
    jest.spyOn(service as never, 'resolveAdapter').mockReturnValue(adapterSpy2 as never);

    await (service as unknown as { runSyncBackground: (id: string, url: string) => Promise<void> })
      .runSyncBackground(orgId, 'https://zaglushka.ru/catalog');

    expect(itemModel._updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ supplierId, active: true }),
      expect.objectContaining({ $set: expect.objectContaining({ active: false }) }),
    );
  });

  it('downloads photos and stores local paths', async () => {
    await buildService(buildOrg());
    const fakePhotoData = Buffer.from('fakeimage');

    async function* fakeGenPhoto() {
      yield {
        vendorArticle: 'ART-P',
        name: 'Photo Item',
        sourceUrl: 'https://zaglushka.ru/p',
        photoUrls: ['https://zaglushka.ru/images/item/photo1.jpg'],
      };
    }

    const adapterSpy3 = {
      fetchItems: jest.fn().mockReturnValue(fakeGenPhoto()),
      fetchRaw: jest.fn().mockResolvedValue(fakePhotoData),
    };
    jest.spyOn(service as never, 'resolveAdapter').mockReturnValue(adapterSpy3 as never);

    await (service as unknown as { runSyncBackground: (id: string, url: string) => Promise<void> })
      .runSyncBackground(orgId, 'https://zaglushka.ru/catalog');

    const calls = itemModel._bulkWriteMock.mock.calls as Array<[Array<unknown>]>;
    const allOps = calls.flatMap(([ops]) => ops);
    expect(allOps.length).toBe(1);
    const update = (allOps[0] as { updateOne: { update: { $set: { photoUrls?: string[] } } } }).updateOne.update.$set;
    expect(update.photoUrls).toBeDefined();
    expect(update.photoUrls![0]).toMatch(/^\/uploads\/suppliers\//);
    // File should exist on disk
    const localFile = path.join(tmpDir, 'suppliers', orgId, 'ART-P_1.jpg');
    expect(fs.existsSync(localFile)).toBe(true);
  });
});

// ─── safe-fetch ────────────────────────────────────────────────────────────

describe('hostAllowed / isPrivateIp', () => {
  it('точный хост и поддомен — да, подстрока — нет', () => {
    expect(hostAllowed('zaglushka.ru', ['zaglushka.ru'])).toBe(true);
    expect(hostAllowed('www.zaglushka.ru', ['zaglushka.ru'])).toBe(true);
    expect(hostAllowed('zaglushka.ru.evil.com', ['zaglushka.ru'])).toBe(false);
    expect(hostAllowed('evilzaglushka.ru', ['zaglushka.ru'])).toBe(false);
  });

  it('приватные адреса v4/v6 и ::ffff:-маппинг', () => {
    for (const ip of ['127.0.0.1', '10.1.1.1', '172.16.0.1', '192.168.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:7f00:1', '::ffff:10.0.0.1']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('2606:4700::1111')).toBe(false);
  });
});

describe('createSafeFetch', () => {
  const origLookup = dnsApi.lookup;
  afterEach(() => { dnsApi.lookup = origLookup; });
  const pub = () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]) as ReturnType<typeof dnsApi.lookup>;
  const res = (status: number, headers: Record<string, string> = {}) =>
    ({ status, ok: status < 300, headers: new Headers(headers) }) as unknown as Response;

  it('отклоняет злой хост (zaglushka.ru.evil.com) до запроса', async () => {
    dnsApi.lookup = pub;
    const base = jest.fn();
    const f = createSafeFetch(base as unknown as typeof fetch, ['zaglushka.ru']);
    await expect(f('https://zaglushka.ru.evil.com/')).rejects.toThrow();
    expect(base).not.toHaveBeenCalled();
  });

  it('отклоняет хост, резолвящийся в приватный IP (любой из адресов)', async () => {
    dnsApi.lookup = () => Promise.resolve([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]) as ReturnType<typeof dnsApi.lookup>;
    await expect(assertPublicHost('zaglushka.ru')).rejects.toThrow();
    const base = jest.fn();
    const f = createSafeFetch(base as unknown as typeof fetch, ['zaglushka.ru']);
    await expect(f('https://zaglushka.ru/')).rejects.toThrow();
    expect(base).not.toHaveBeenCalled();
  });

  it('редирект на чужой хост отклоняется', async () => {
    dnsApi.lookup = pub;
    const base = jest.fn().mockResolvedValue(res(302, { location: 'http://169.254.169.254/latest' }));
    const f = createSafeFetch(base as unknown as typeof fetch, ['zaglushka.ru']);
    await expect(f('https://zaglushka.ru/a')).rejects.toThrow();
    expect(base).toHaveBeenCalledTimes(1);
    expect(base.mock.calls[0][1]).toEqual(expect.objectContaining({ redirect: 'manual' }));
  });

  it('редирект внутри белого списка — вручную; больше 3 — отказ', async () => {
    dnsApi.lookup = pub;
    const ok = jest.fn()
      .mockResolvedValueOnce(res(301, { location: '/b' }))
      .mockResolvedValueOnce(res(200));
    const f = createSafeFetch(ok as unknown as typeof fetch, ['zaglushka.ru']);
    expect((await f('https://zaglushka.ru/a')).status).toBe(200);
    expect(ok.mock.calls[1][0]).toBe('https://zaglushka.ru/b');

    const loop = jest.fn().mockResolvedValue(res(302, { location: '/again' }));
    const f2 = createSafeFetch(loop as unknown as typeof fetch, ['zaglushka.ru']);
    await expect(f2('https://zaglushka.ru/a')).rejects.toThrow();
    expect(loop).toHaveBeenCalledTimes(4);
  });
});

// ─── Итог синхронизации и валидация ──────────────────────────────────────────

describe('SupplierCatalogService: безопасность итога и вход', () => {
  const orgId = new Types.ObjectId().toString();
  let itemModel: ReturnType<typeof makeMockModel>;
  let orgModel: ReturnType<typeof makeMockOrgModel> & { updateMany?: jest.Mock };
  let service: SupplierCatalogService;
  let tmpDir: string;

  async function build(org: Record<string, unknown> | null = { _id: new Types.ObjectId(orgId), catalogUrl: 'https://zaglushka.ru/' }) {
    itemModel = makeMockModel();
    orgModel = makeMockOrgModel(org);
    orgModel.updateMany = jest.fn().mockResolvedValue({});
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc2-test-'));
    const module = await Test.createTestingModule({
      providers: [
        SupplierCatalogService,
        { provide: getModelToken(SupplierItem.name), useValue: itemModel },
        { provide: getModelToken(Organization.name), useValue: orgModel },
        { provide: getConnectionToken(), useValue: {} },
      ],
    }).compile();
    service = module.get(SupplierCatalogService);
    service.uploadsDir = tmpDir;
  }
  afterEach(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  type Run = (id: string, url: string) => Promise<void>;
  const run = () => (service as unknown as { runSyncBackground: Run }).runSyncBackground(orgId, 'https://zaglushka.ru/');
  const item = (n: number) => ({ vendorArticle: `A-${n}`, name: `N${n}`, sourceUrl: `https://zaglushka.ru/${n}` });

  function useAdapter(gen: () => AsyncGenerator<unknown>, complete: boolean) {
    const adapter = { hosts: ['zaglushka.ru'], complete, fetchItems: jest.fn().mockImplementation(gen), fetchRaw: jest.fn().mockResolvedValue(null) };
    jest.spyOn(service as never, 'resolveAdapter').mockReturnValue(adapter as never);
    return adapter;
  }

  it('ошибка первой страницы → статус error, без деактивации', async () => {
    await build();
    useAdapter(async function* () { throw new Error('Не удалось загрузить первую страницу каталога'); yield item(0); }, false);
    await run();
    expect(itemModel._updateManyMock).not.toHaveBeenCalled();
    expect(orgModel.updateOne).toHaveBeenCalledWith(
      { _id: orgId },
      { $set: expect.objectContaining({ catalogSyncStatus: 'error' }) },
    );
  });

  it('частичный обход (complete=false) → без деактивации', async () => {
    await build();
    useAdapter(async function* () { yield item(1); }, false);
    await run();
    expect(itemModel._updateManyMock).not.toHaveBeenCalled();
  });

  it('собрано < 50% прежних активных → без деактивации', async () => {
    await build();
    itemModel.countDocuments.mockResolvedValue(10);
    useAdapter(async function* () { yield item(1); yield item(2); }, true);
    await run();
    expect(itemModel._updateManyMock).not.toHaveBeenCalled();
  });

  it('полный обход и достаточно собрано → деактивация пропавших', async () => {
    await build();
    itemModel.countDocuments.mockResolvedValue(2);
    useAdapter(async function* () { yield item(1); yield item(2); }, true);
    await run();
    expect(itemModel._updateManyMock).toHaveBeenCalledTimes(1);
  });

  it('startSync: невалидный orgId → 400', async () => {
    await build();
    await expect(service.startSync('abc')).rejects.toThrow(BadRequestException);
  });

  it('listItems: невалидный supplierId и нецелые page/limit → 400', async () => {
    await build();
    await expect(service.listItems({ supplierId: 'x' })).rejects.toThrow(BadRequestException);
    await expect(service.listItems({ supplierId: orgId, page: NaN })).rejects.toThrow(BadRequestException);
    await expect(service.listItems({ supplierId: orgId, limit: 1.5 })).rejects.toThrow(BadRequestException);
    const r = await service.listItems({ supplierId: orgId, limit: 9999 });
    expect(r.limit).toBe(200);
  });

  it('onModuleInit: зависшие running → error «прервано перезапуском»', async () => {
    await build();
    await service.onModuleInit();
    expect(orgModel.updateMany).toHaveBeenCalledWith(
      { catalogSyncStatus: 'running' },
      { $set: expect.objectContaining({ catalogSyncStatus: 'error', catalogSyncError: expect.stringContaining('перезапуском') }) },
    );
  });

  it('resolveAdapter: злой хост отклонён', async () => {
    await build();
    const r = (u: string) => (service as unknown as { resolveAdapter: (u: string) => unknown }).resolveAdapter(u);
    expect(() => r('https://zaglushka.ru.evil.com/')).toThrow(BadRequestException);
    expect(r('https://zaglushka.ru/')).toBeDefined();
  });

  it('getSuppliers: с позициями ИЛИ с catalogUrl, itemCount 0 у новых', async () => {
    await build();
    const withItems = new Types.ObjectId();
    const fresh = new Types.ObjectId();
    itemModel._aggregateMock.mockResolvedValue([{ _id: withItems, n: 7 }]);
    (orgModel as unknown as { find: jest.Mock }).find = jest.fn().mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve([{ _id: withItems, name: 'A' }, { _id: fresh, name: 'B' }]) }),
    });
    const r = await service.getSuppliers();
    expect(r.items).toEqual([
      { id: String(withItems), name: 'A', itemCount: 7 },
      { id: String(fresh), name: 'B', itemCount: 0 },
    ]);
    const filter = (orgModel as unknown as { find: jest.Mock }).find.mock.calls[0][0];
    expect(filter.deletedAt).toBeNull();
    expect(JSON.stringify(filter.$or)).toContain('catalogUrl');
  });
});
