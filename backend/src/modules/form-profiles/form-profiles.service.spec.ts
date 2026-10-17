import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FormProfilesService } from './form-profiles.service';
import {
  DEFAULT_VISIBLE,
  LOCKED_REQUIRED,
} from './form-profile.constants';

/**
 * TZ-DICT-314 — hermetic unit tests (no Mongo).
 * AC: LockedRequired reject; seed idempotent; unique compound key behavior.
 */

type MockDoc = Record<string, unknown> & {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  entity: string;
  size: string;
  visibleFieldKeys: string[];
};

class FakeOrgModel {
  orgs: { _id: Types.ObjectId; name: string }[] = [];

  findOne = jest.fn(() => {
    const first = this.orgs[0] ?? null;
    const chain = {
      sort: jest.fn(),
      select: jest.fn(),
      lean: jest.fn(),
      exec: jest.fn(async () => (first ? { _id: first._id } : null)),
    };
    chain.sort.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    chain.lean.mockReturnValue(chain);
    return chain;
  });
}

class FakeFormProfileModel {
  store: MockDoc[] = [];
  uniqueEnforced = true;

  reset() {
    this.store = [];
  }

  private findInStore(
    organizationId: Types.ObjectId,
    entity: string,
    size: string,
  ): MockDoc | undefined {
    return this.store.find(
      (d) =>
        String(d.organizationId) === String(organizationId) &&
        d.entity === entity &&
        d.size === size,
    );
  }

  create = jest.fn(async (doc: Record<string, unknown>) => {
    const organizationId = doc.organizationId as Types.ObjectId;
    const entity = doc.entity as string;
    const size = doc.size as string;
    if (this.uniqueEnforced && this.findInStore(organizationId, entity, size)) {
      const err = new Error('E11000 duplicate key') as Error & { code: number };
      err.code = 11000;
      throw err;
    }
    const created: MockDoc = {
      _id: new Types.ObjectId(),
      organizationId,
      entity,
      size,
      visibleFieldKeys: [...(doc.visibleFieldKeys as string[])],
    };
    this.store.push(created);
    return created;
  });

  findOne = jest.fn((filter: Record<string, unknown>) => {
    const organizationId = filter.organizationId as Types.ObjectId;
    const entity = filter.entity as string;
    const size = filter.size as string;
    const hit = this.findInStore(organizationId, entity, size);
    const chain: {
      select: jest.Mock;
      lean: jest.Mock;
      exec: jest.Mock;
    } = {
      select: jest.fn(),
      lean: jest.fn(),
      exec: jest.fn(async () => (hit ? { ...hit } : null)),
    };
    chain.select.mockReturnValue(chain);
    chain.lean.mockReturnValue(chain);
    return chain;
  });

  find = jest.fn((filter: Record<string, unknown>) => {
    const organizationId = filter.organizationId as Types.ObjectId;
    let rows = this.store.filter(
      (d) => String(d.organizationId) === String(organizationId),
    );
    if (filter.entity) {
      rows = rows.filter((d) => d.entity === filter.entity);
    }
    return {
      sort: jest.fn(() => ({
        exec: jest.fn(async () => rows.map((r) => ({ ...r }))),
      })),
    };
  });

  findOneAndUpdate = jest.fn(
    (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown> },
    ) => {
      const organizationId = filter.organizationId as Types.ObjectId;
      const entity = filter.entity as string;
      const size = filter.size as string;
      let doc = this.findInStore(organizationId, entity, size);
      if (!doc) {
        doc = {
          _id: new Types.ObjectId(),
          organizationId,
          entity,
          size,
          visibleFieldKeys: [],
        };
        this.store.push(doc);
      }
      if (update.$set?.visibleFieldKeys) {
        doc.visibleFieldKeys = [
          ...(update.$set.visibleFieldKeys as string[]),
        ];
      }
      return { exec: jest.fn(async () => ({ ...doc })) };
    },
  );
}

describe('FormProfilesService (TZ-DICT-314)', () => {
  const ORG = new Types.ObjectId().toHexString();
  let service: FormProfilesService;
  let model: FakeFormProfileModel;
  let orgModel: FakeOrgModel;

  beforeEach(() => {
    model = new FakeFormProfileModel();
    orgModel = new FakeOrgModel();
    orgModel.orgs = [{ _id: new Types.ObjectId(ORG), name: 'Demo Org' }];
    service = new FormProfilesService(
      model as unknown as ConstructorParameters<typeof FormProfilesService>[0],
      orgModel as unknown as ConstructorParameters<typeof FormProfilesService>[1],
    );
  });

  describe('validateVisibleKeys / LockedRequired', () => {
    it('rejects stripping product LockedRequired (400)', () => {
      expect(() =>
        service.validateVisibleKeys('product', ['sku', 'listPrice']),
      ).toThrow(BadRequestException);
      try {
        service.validateVisibleKeys('product', ['name', 'kind']); // missing unit
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toMatch(/LockedRequired/);
        expect((e as BadRequestException).message).toMatch(/unit/);
      }
    });

    it('rejects stripping module LockedRequired name', () => {
      expect(() =>
        service.validateVisibleKeys('module', ['article', 'notes']),
      ).toThrow(/LockedRequired/);
    });

    it('rejects unknown FieldKeys', () => {
      expect(() =>
        service.validateVisibleKeys('product', [
          ...LOCKED_REQUIRED.product,
          'workTypes',
        ]),
      ).toThrow(/Unknown FieldKey/);
    });

    it('accepts valid product M set', () => {
      const keys = service.validateVisibleKeys('product', [
        ...DEFAULT_VISIBLE.product.M,
      ]);
      expect(keys).toEqual([...DEFAULT_VISIBLE.product.M]);
    });
  });

  describe('seed idempotent', () => {
    it('inserts 6 defaults on first ensureSeeded', async () => {
      const orgOid = new Types.ObjectId(ORG);
      const n = await service.ensureSeeded(orgOid);
      expect(n).toBe(6);
      expect(model.store).toHaveLength(6);

      const productS = model.store.find(
        (d) => d.entity === 'product' && d.size === 'S',
      );
      expect(productS?.visibleFieldKeys).toEqual([
        ...DEFAULT_VISIBLE.product.S,
      ]);
    });

    it('second ensureSeeded inserts 0 (idempotent)', async () => {
      const orgOid = new Types.ObjectId(ORG);
      await service.ensureSeeded(orgOid);
      const n2 = await service.ensureSeeded(orgOid);
      expect(n2).toBe(0);
      expect(model.store).toHaveLength(6);
    });

    it('list seeds then returns profiles without overwrite', async () => {
      const list1 = await service.list(ORG, 'product');
      expect(list1).toHaveLength(3);
      // Mutate S away from default
      await service.upsert(ORG, 'product', 'S', [
        'name',
        'kind',
        'unit',
        'sku',
      ]);
      const list2 = await service.list(ORG, 'product');
      const s = list2.find((d) => d.size === 'S');
      expect(s?.visibleFieldKeys).toEqual(['name', 'kind', 'unit', 'sku']);
      expect(model.store.filter((d) => d.entity === 'product')).toHaveLength(3);
    });
  });

  describe('unique compound (organizationId, entity, size)', () => {
    it('create race on same key reuses existing via 11000 path', async () => {
      const orgOid = new Types.ObjectId(ORG);
      await service.ensureSeeded(orgOid, 'module');
      expect(
        model.store.filter((d) => d.entity === 'module'),
      ).toHaveLength(3);

      // Force duplicate create → 11000 → re-read
      const again = await (
        service as unknown as {
          insertDefault: (
            o: Types.ObjectId,
            e: string,
            s: string,
          ) => Promise<MockDoc>;
        }
      ).insertDefault(orgOid, 'module', 'S');
      expect(again.entity).toBe('module');
      expect(again.size).toBe('S');
      expect(model.store.filter((d) => d.entity === 'module')).toHaveLength(3);
    });

    it('different orgs may share entity/size', async () => {
      const orgB = new Types.ObjectId().toHexString();
      await service.list(ORG, 'product');
      await service.list(orgB, 'product');
      expect(model.store.filter((d) => d.entity === 'product')).toHaveLength(6);
    });
  });

  describe('upsert LockedRequired gate', () => {
    it('PUT path rejects strip of kind', async () => {
      await expect(
        service.upsert(ORG, 'product', 'M', ['name', 'unit', 'sku']),
      ).rejects.toThrow(/LockedRequired/);
    });

    it('PUT path persists when locked present', async () => {
      const doc = await service.upsert(ORG, 'module', 'L', [
        'name',
        'article',
        'notes',
      ]);
      expect(doc.visibleFieldKeys).toEqual(['name', 'article', 'notes']);
    });
  });

  describe('param validation', () => {
    it('rejects bad entity/size', async () => {
      await expect(service.getOne(ORG, 'material', 'S')).rejects.toThrow(
        /entity/,
      );
      await expect(service.getOne(ORG, 'product', 'XL')).rejects.toThrow(
        /size/,
      );
    });

    it('system admin without org falls back to first Organization', async () => {
      const rows = await service.list(null);
      expect(rows.length).toBe(6);
      expect(String(rows[0].organizationId)).toBe(ORG);
    });

    it('rejects when user has no org and no Organization exists', async () => {
      orgModel.orgs = [];
      await expect(service.list(null)).rejects.toThrow(/Нет организации/);
    });
  });
});
