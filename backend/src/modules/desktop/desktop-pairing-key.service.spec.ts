import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  DesktopPairingKeyService,
  hashPairingSecret,
  isPairingKeyBearer,
} from './desktop-pairing-key.service';
import { DesktopPairingKey } from './desktop-pairing-key.schema';
import { UserService } from '../user/user.service';

describe('DesktopPairingKeyService (TZD-21)', () => {
  let service: DesktopPairingKeyService;
  const docs: Array<Record<string, unknown>> = [];
  let idSeq = 0;

  const model = {
    create: jest.fn(async (data: Record<string, unknown>) => {
      idSeq += 1;
      const id = `507f1f77bcf86cd7994390${String(10 + idSeq).padStart(2, '0')}`;
      const doc = {
        ...data,
        id,
        _id: id,
        save: jest.fn(async function (this: Record<string, unknown>) {
          return this;
        }),
      };
      docs.push(doc);
      return doc;
    }),
    find: jest.fn((q: Record<string, unknown> = {}) => ({
      sort: () => ({
        lean: () => ({
          exec: async () =>
            docs
              .filter((d) => {
                if (q.revokedAt === null && d.revokedAt) return false;
                return true;
              })
              .map((d) => ({
                ...d,
                _id: d.id,
                createdAt: new Date(),
              })),
        }),
      }),
    })),
    findOne: jest.fn((q: Record<string, unknown>) => {
      const exec = async () => {
        if (q.tokenHash) {
          return docs.find((d) => d.tokenHash === q.tokenHash) ?? null;
        }
        if (q._id) {
          const d = docs.find((x) => x.id === q._id || x._id === q._id);
          if (!d) return null;
          if (q.userId && String(d.userId) !== String(q.userId)) return null;
          return d;
        }
        return null;
      };
      return { exec };
    }),
    deleteOne: jest.fn((q: Record<string, unknown>) => ({
      exec: async () => {
        const idx = docs.findIndex((x) => {
          if (String(x.id) !== String(q._id) && String(x._id) !== String(q._id)) return false;
          if (q.userId && String(x.userId) !== String(q.userId)) return false;
          return true;
        });
        if (idx < 0) return { deletedCount: 0 };
        docs.splice(idx, 1);
        return { deletedCount: 1 };
      },
    })),
    countDocuments: jest.fn(() => ({
      exec: async () =>
        docs.filter((d) => !d.revokedAt && (!d.expiresAt || (d.expiresAt as Date) > new Date()))
          .length,
    })),
  };

  const USER_ID = '507f1f77bcf86cd799439011';

  const users = {
    findById: jest.fn(async (id: string) =>
      id === USER_ID
        ? {
            id: USER_ID,
            username: 'admin',
            role: 'admin',
            permissions: ['*'],
            organizationId: null,
            isActive: true,
          }
        : null,
    ),
  };

  beforeEach(async () => {
    docs.length = 0;
    idSeq = 0;
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DesktopPairingKeyService,
        { provide: getModelToken(DesktopPairingKey.name), useValue: model },
        { provide: UserService, useValue: users },
      ],
    }).compile();
    service = module.get(DesktopPairingKeyService);
  });

  it('hashes secrets and detects pairing bearer prefix', () => {
    expect(isPairingKeyBearer('kppd_abc')).toBe(true);
    expect(isPairingKeyBearer('eyJhbG')).toBe(false);
    expect(hashPairingSecret('kppd_x')).toHaveLength(64);
  });

  it('issues key with 30d default and returns plaintext once', async () => {
    const res = await service.issue(
      { id: USER_ID, username: 'admin', role: 'admin' },
      { apiBaseUrl: 'http://127.0.0.1:3000', ttl: '30d' },
    );
    expect(res.apiKey.startsWith('kppd_')).toBe(true);
    expect(res.pairing.apiKey).toBe(res.apiKey);
    expect(res.expiresAt).toBeTruthy();
    const exp = new Date(res.expiresAt!).getTime();
    expect(exp).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
    expect(docs[0]!.tokenHash).toBe(hashPairingSecret(res.apiKey));
    expect(docs[0]!.tokenHash).not.toContain(res.apiKey);
  });

  it('never ttl → expiresAt null', async () => {
    const res = await service.issue(
      { id: USER_ID, username: 'admin', role: 'admin' },
      { apiBaseUrl: 'http://127.0.0.1:3000', ttl: 'never' },
    );
    expect(res.expiresAt).toBeNull();
    expect(res.pairing.expiresAt).toBeNull();
  });

  it('second issue does not revoke first; both authenticate', async () => {
    const a = await service.issue(
      { id: USER_ID, username: 'admin', role: 'admin' },
      { apiBaseUrl: 'http://127.0.0.1:3000' },
    );
    const b = await service.issue(
      { id: USER_ID, username: 'admin', role: 'admin' },
      { apiBaseUrl: 'http://127.0.0.1:3000' },
    );
    expect(a.apiKey).not.toBe(b.apiKey);
    const ua = await service.authenticateBearer(a.apiKey);
    const ub = await service.authenticateBearer(b.apiKey);
    expect(ua.username).toBe('admin');
    expect(ub.username).toBe('admin');
  });

  it('revoke one key → only that key fails', async () => {
    const a = await service.issue(
      { id: USER_ID, username: 'admin', role: 'admin' },
      { apiBaseUrl: 'http://127.0.0.1:3000' },
    );
    const b = await service.issue(
      { id: USER_ID, username: 'admin', role: 'admin' },
      { apiBaseUrl: 'http://127.0.0.1:3000' },
    );
    await service.revoke(USER_ID, a.id);
    await expect(service.authenticateBearer(a.apiKey)).rejects.toThrow(
      /invalid pairing key|revoked/i,
    );
    const ub = await service.authenticateBearer(b.apiKey);
    expect(ub.id).toBe(USER_ID);
    const list = await service.listForUser(USER_ID);
    expect(list.map((k) => k.id)).toEqual([b.id]);
  });

  it('list does not include plaintext secret', async () => {
    const issued = await service.issue(
      { id: USER_ID, username: 'admin', role: 'admin' },
      { apiBaseUrl: 'http://127.0.0.1:3000', label: 'Office PC' },
    );
    const list = await service.listForUser(USER_ID);
    expect(list[0]!.label).toBe('Office PC');
    expect(list[0]!.tokenPrefix.startsWith('kppd_')).toBe(true);
    expect(JSON.stringify(list)).not.toContain(issued.apiKey);
  });

  it('list omits revoked keys after revoke', async () => {
    const issued = await service.issue(
      { id: USER_ID, username: 'admin', role: 'admin' },
      { apiBaseUrl: 'http://127.0.0.1:3000', label: 'Gone' },
    );
    await service.revoke(USER_ID, issued.id);
    expect(await service.listForUser(USER_ID)).toEqual([]);
  });
});
