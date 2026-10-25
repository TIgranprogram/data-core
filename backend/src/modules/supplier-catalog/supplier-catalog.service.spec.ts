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

  it('rejects non-http protocol', () => {
    expect(() => checkSsrf('ftp://external.com/catalog')).toThrow(BadRequestException);
  });
});

// ─── Service tests ────────────────────────────────────────────────────────

function makeMockModel() {
  const bulkWriteMock = jest.fn().mockResolvedValue({});
  const updateManyMock = jest.fn().mockResolvedValue({});
  const countDocumentsMock = jest.fn().mockResolvedValue(0);
  const findMock = jest.fn().mockReturnValue({
    skip: () => ({ limit: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }) }),
  });

  return {
    bulkWrite: bulkWriteMock,
    updateMany: updateManyMock,
    countDocuments: countDocumentsMock,
    find: findMock,
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

    const adapterSpy2 = { fetchItems: jest.fn().mockReturnValue(fakeGen2()), fetchRaw: jest.fn().mockResolvedValue(null) };
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
