import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkerService } from './worker.service';
import { Worker } from './worker.schema';
import { WorkType } from '../work-type/work-type.schema';
import { Organization } from '../organization/organization.schema';
import { User } from '../user/user.schema';

/**
 * TZ-WORKERS-301 — Unit spec for WorkerService (единая «Люди»-сущность).
 *
 * Hermetic: in-memory fake-модели (@InjectModel для Worker/WorkType/
 * Organization/User), без Mongo. Покрывает acceptance criteria:
 *  - create с валидным/битым FK (404);
 *  - supplierId не-поставщик → 400;
 *  - update с email-коллизией (409);
 *  - findAll: envelope + org-scope + search/filter;
 *  - soft-delete через deletedAt;
 *  - IDOR: cross-org update/remove → 403;
 *  - legacy-записи без новых полей продолжают открываться.
 */

type MockDoc = Record<string, unknown> & {
  _id: Types.ObjectId;
  save: jest.Mock;
  organizationId?: Types.ObjectId | null;
  deletedAt?: Date | null;
  type?: string[];
  email?: string;
  workTypeIds?: Types.ObjectId[];
};

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (Array.isArray(a)) {
    return a.some((item) => String(item) === String(b));
  }
  return String(a) === String(b);
}

function matchesQuery(doc: MockDoc, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([k, v]) => {
    if (k === '$or') {
      return (v as Record<string, unknown>[]).some((cond) =>
        matchesQuery(doc, cond),
      );
    }
    if (v && typeof v === 'object' && '$exists' in v) {
      const present = doc[k] !== undefined && doc[k] !== null;
      return v.$exists ? present : !present;
    }
    if (v && typeof v === 'object' && '$in' in v) {
      const list = (v as { $in: unknown[] }).$in;
      return list.some((item) => valuesEqual(doc[k], item));
    }
    if (v && typeof v === 'object' && '$ne' in v) {
      return !valuesEqual(doc[k], (v as { $ne: unknown }).$ne);
    }
    if (v instanceof RegExp) {
      return v.test(String(doc[k] ?? ''));
    }
    if (v && typeof v === 'object' && '$regex' in v) {
      const raw = (v as { $regex: RegExp }).$regex;
      const re = raw instanceof RegExp ? raw : new RegExp(String(raw), 'i');
      return re.test(String(doc[k] ?? ''));
    }
    return valuesEqual(doc[k], v);
  });
}

class FakeModel {
  public store: Map<string, MockDoc> = new Map();

  reset() {
    this.store.clear();
  }

  makeDoc(partial: Record<string, unknown>): MockDoc {
    const _id = (partial._id as Types.ObjectId) ?? new Types.ObjectId();
    const doc: MockDoc = {
      ...partial,
      _id,
      save: jest.fn(async () => {
        // Mimic sparse-unique { organizationId, email } violation on save.
        if (doc.email !== undefined && doc.organizationId) {
          const dup = Array.from(this.store.values()).find((d) => {
            if (String(d._id) === String(doc._id)) return false;
            return (
              d.email !== undefined &&
              String(d.email).toLowerCase() === String(doc.email).toLowerCase() &&
              d.organizationId &&
              String(d.organizationId) === String(doc.organizationId)
            );
          });
          if (dup) {
            const err = new Error('duplicate key');
            (err as { code?: number }).code = 11000;
            throw err;
          }
        }
        return doc;
      }),
    };
    this.store.set(String(_id), doc);
    return doc;
  }

  findById = jest.fn((id: string) => ({
    select: jest.fn(() => ({
      exec: jest.fn(async () => {
        const doc = this.store.get(String(id));
        if (!doc) return null;
        return doc;
      }),
    })),
  }));

  findOne = jest.fn((query: Record<string, unknown>) => {
    const matches = Array.from(this.store.values()).filter((d) =>
      matchesQuery(d, query),
    );
    const select = jest.fn(() => ({ exec: jest.fn(async () => matches[0] ?? null) }));
    return { select, exec: jest.fn(async () => matches[0] ?? null) };
  });

  countDocuments = jest.fn((query: Record<string, unknown>) => {
    const matches = Array.from(this.store.values()).filter((d) =>
      matchesQuery(d, query),
    );
    return { exec: jest.fn(async () => matches.length) };
  });

  find = jest.fn((query: Record<string, unknown>) => {
    const matches = Array.from(this.store.values()).filter((d) =>
      matchesQuery(d, query),
    );
    return {
      sort: jest.fn(() => ({
        skip: jest.fn(() => ({
          limit: jest.fn(() => ({
            exec: jest.fn(async () => matches),
          })),
        })),
      })),
    };
  });

  create = jest.fn(async (doc: Record<string, unknown>) => {
    // Mimic sparse-unique { organizationId, email } violation on insert.
    const dup = Array.from(this.store.values()).find((d) => {
      const sameOrg = String(d.organizationId ?? '') === String(doc.organizationId ?? '');
      const sameEmail = d.email !== undefined && doc.email !== undefined &&
        String(d.email).toLowerCase() === String(doc.email).toLowerCase();
      return sameOrg && sameEmail;
    });
    if (dup) {
      const err = new Error('duplicate key');
      (err as { code?: number }).code = 11000;
      throw err;
    }
    return this.makeDoc(doc);
  });

  updateOne = jest.fn((filter: Record<string, unknown>, update: Record<string, unknown>) => {
    const target = Array.from(this.store.values()).find((d) =>
      matchesQuery(d, filter),
    );
    if (target) {
      const set = (update.$set ?? {}) as Record<string, unknown>;
      Object.entries(set).forEach(([k, v]) => {
        (target as Record<string, unknown>)[k] = v;
      });
    }
    return { exec: jest.fn(async () => ({ modifiedCount: target ? 1 : 0 })) };
  });
}

describe('WorkerService (TZ-WORKERS-301)', () => {
  let service: WorkerService;
  let workerModel: FakeModel;
  let workTypeModel: FakeModel;
  let orgModel: FakeModel;
  let userModel: FakeModel;

  beforeEach(async () => {
    workerModel = new FakeModel();
    workTypeModel = new FakeModel();
    orgModel = new FakeModel();
    userModel = new FakeModel();

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkerService,
        { provide: getModelToken(Worker.name), useValue: workerModel },
        { provide: getModelToken(WorkType.name), useValue: workTypeModel },
        { provide: getModelToken(Organization.name), useValue: orgModel },
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile();

    service = moduleRef.get(WorkerService);
  });

  const orgId = String(new Types.ObjectId());
  const baseDto = {
    lastName: 'Иванов',
    firstName: 'Иван',
  };

  // ── create ────────────────────────────────────────────────────────────
  describe('create', () => {
    it('creates with organizationId scope, email lowercased, isActive default true', async () => {
      const created = await service.create(
        { ...baseDto, email: '  IVAN@Example.COM ', ratePerHour: 5 },
        orgId,
      );
      expect(created.email).toBe('ivan@example.com');
      expect(created.organizationId?.toString()).toBe(orgId);
      expect(created.isActive).toBe(true);
      expect(created.workTypeIds).toEqual([]);
    });

    it('404 on broken workTypeIds ref', async () => {
      const missing = String(new Types.ObjectId());
      await expect(
        service.create({ ...baseDto, workTypeIds: [missing] }, orgId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 on missing supplier organization', async () => {
      await expect(
        service.create(
          { ...baseDto, supplierId: String(new Types.ObjectId()) },
          orgId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400 when supplier org is not of type supplier', async () => {
      const supplier = orgModel.makeDoc({
        _id: new Types.ObjectId(),
        type: ['customer'],
      });
      await expect(
        service.create({ ...baseDto, supplierId: String(supplier._id) }, orgId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404 on missing userId', async () => {
      await expect(
        service.create({ ...baseDto, userId: String(new Types.ObjectId()) }, orgId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409 on email collision in same org scope', async () => {
      const supplier = orgModel.makeDoc({
        _id: new Types.ObjectId(),
        type: ['supplier'],
      });
      workerModel.makeDoc({
        _id: new Types.ObjectId(),
        email: 'dup@example.com',
        organizationId: new Types.ObjectId(orgId),
      });
      await expect(
        service.create(
          { ...baseDto, email: 'DUP@example.com', supplierId: String(supplier._id) },
          orgId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── findAll ───────────────────────────────────────────────────────────
  describe('findAll', () => {
    it('returns envelope and filters out soft-deleted', async () => {
      workerModel.makeDoc({
        _id: new Types.ObjectId(),
        lastName: 'Петров',
        deletedAt: null,
      });
      workerModel.makeDoc({
        _id: new Types.ObjectId(),
        lastName: 'Сидоров',
        deletedAt: new Date(),
      });
      const res = await service.findAll({}, orgId);
      expect(res).toHaveProperty('items');
      expect(res.items.length).toBe(1);
      expect(res.total).toBe(1);
      expect(res.page).toBe(1);
      expect(res.limit).toBe(20);
    });

    it('filters by search on lastName', async () => {
      workerModel.makeDoc({
        _id: new Types.ObjectId(),
        lastName: 'Иванов',
        deletedAt: null,
      });
      workerModel.makeDoc({
        _id: new Types.ObjectId(),
        lastName: 'Петров',
        deletedAt: null,
      });
      const res = await service.findAll({ search: 'ива' }, orgId);
      expect(res.total).toBe(1);
      expect(res.items[0].lastName).toBe('Иванов');
    });

    it('filters by workTypeId (array containment)', async () => {
      const wt = new Types.ObjectId();
      workerModel.makeDoc({
        _id: new Types.ObjectId(),
        workTypeIds: [wt],
        deletedAt: null,
      });
      const res = await service.findAll({ workTypeId: String(wt) }, orgId);
      expect(res.total).toBe(1);
    });

    it('clamps limit to MAX (100)', async () => {
      const res = await service.findAll({ limit: 500 }, orgId);
      expect(res.limit).toBe(100);
    });
  });

  // ── IDOR guard ────────────────────────────────────────────────────────
  describe('update (IDOR)', () => {
    it('403 when updating a worker of another org scope', async () => {
      const foreign = new Types.ObjectId();
      const doc = workerModel.makeDoc({
        _id: new Types.ObjectId(),
        lastName: 'Чужой',
        firstName: 'Чужой',
        organizationId: foreign,
        deletedAt: null,
      });
      await expect(
        service.update(String(doc._id), { firstName: 'X' }, orgId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows update within same org and normalizes email', async () => {
      const doc = workerModel.makeDoc({
        _id: new Types.ObjectId(),
        lastName: 'Иванов',
        firstName: 'Иван',
        organizationId: new Types.ObjectId(orgId),
        deletedAt: null,
        email: 'old@example.com',
      });
      const updated = await service.update(
        String(doc._id),
        { email: '  NEW@Example.COM ' },
        orgId,
      );
      expect(updated.email).toBe('new@example.com');
    });

    it('409 on email collision during update', async () => {
      const doc = workerModel.makeDoc({
        _id: new Types.ObjectId(),
        lastName: 'Иванов',
        firstName: 'Иван',
        organizationId: new Types.ObjectId(orgId),
        deletedAt: null,
        email: 'a@example.com',
      });
      workerModel.makeDoc({
        _id: new Types.ObjectId(),
        lastName: 'Другой',
        firstName: 'Другой',
        organizationId: new Types.ObjectId(orgId),
        deletedAt: null,
        email: 'b@example.com',
      });
      await expect(
        service.update(String(doc._id), { email: 'b@example.com' }, orgId),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── soft delete + legacy ──────────────────────────────────────────────
  describe('remove / legacy', () => {
    it('soft-deletes via deletedAt; findById then 404s', async () => {
      const doc = workerModel.makeDoc({
        _id: new Types.ObjectId(),
        lastName: 'Иванов',
        firstName: 'Иван',
        organizationId: new Types.ObjectId(orgId),
        deletedAt: null,
      });
      await service.remove(String(doc._id), orgId);
      expect(doc.deletedAt).toBeInstanceOf(Date);
      await expect(
        service.findById(String(doc._id)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('legacy worker without new fields still opens (backward compat)', async () => {
      const legacy = workerModel.makeDoc({
        _id: new Types.ObjectId(),
        lastName: 'Старый',
        firstName: 'Сотрудник',
        deletedAt: null,
        // никаких новых полей (email, organizationId, ...)
      });
      const found = await service.findById(String(legacy._id));
      expect(found.firstName).toBe('Сотрудник');
      expect(found.email).toBeUndefined();
    });

    it('403 when removing a worker of another org scope', async () => {
      const doc = workerModel.makeDoc({
        _id: new Types.ObjectId(),
        lastName: 'Чужой',
        firstName: 'Чужой',
        organizationId: new Types.ObjectId(),
        deletedAt: null,
      });
      await expect(
        service.remove(String(doc._id), orgId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
