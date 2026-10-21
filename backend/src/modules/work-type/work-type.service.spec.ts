import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateWorkTypeDto } from './dto/create-work-type.dto';
import { WorkTypeService } from './work-type.service';
import { WorkType } from './work-type.schema';

/**
 * TZ-PRODUCTION-302 — Unit spec for WorkTypeService.days.
 *
 * Hermetic fake-модель (без Mongo). Покрывает AC:
 *  - days сохраняется round-trip (create + update);
 *  - null допустим (stuck path, unknown duration);
 *  - legacy-запись без days открывается (backward compat).
 */

type MockDoc = Record<string, unknown> & {
  _id: Types.ObjectId;
  save: jest.Mock;
};

class FakeWorkTypeModel {
  public store: Map<string, MockDoc> = new Map();

  reset() {
    this.store.clear();
  }

  makeDoc(partial: Record<string, unknown> = {}): MockDoc {
    const _id = (partial._id as Types.ObjectId) ?? new Types.ObjectId();
    const doc: MockDoc = {
      ...partial,
      _id,
      save: jest.fn(async () => doc),
    };
    this.store.set(String(_id), doc);
    return doc;
  }

  create = jest.fn(async (doc: Record<string, unknown>) => {
    return this.makeDoc(doc);
  });

  findById = jest.fn((id: string) => ({
    exec: jest.fn(async () => {
      const doc = this.store.get(String(id));
      if (!doc) return null;
      return doc;
    }),
  }));

  find = jest.fn(() => ({
    sort: jest.fn(() => ({ exec: jest.fn(async () => Array.from(this.store.values())) })),
  }));

  updateOne = jest.fn(
    (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const target = Array.from(this.store.values()).find(
        (d) => String(d._id) === String(filter._id),
      );
      if (target) {
        const set = (update.$set ?? {}) as Record<string, unknown>;
        Object.entries(set).forEach(([k, v]) => {
          (target as Record<string, unknown>)[k] = v;
        });
      }
      return { exec: jest.fn(async () => ({ modifiedCount: target ? 1 : 0 })) };
    },
  );

  updateMany = jest.fn(() => ({
    exec: jest.fn(async () => ({ modifiedCount: 0, matchedCount: 0 })),
  }));
}

describe('WorkTypeService (TZ-PRODUCTION-302)', () => {
  let service: WorkTypeService;
  let model: FakeWorkTypeModel;

  beforeEach(async () => {
    model = new FakeWorkTypeModel();
    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkTypeService,
        { provide: getModelToken(WorkType.name), useValue: model },
      ],
    }).compile();
    service = moduleRef.get(WorkTypeService);
  });

  it('transforms a numeric string before validation', async () => {
    const dto = plainToInstance(CreateWorkTypeDto, {
      name: 'Покраска',
      hourlyRate: '150',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.hourlyRate).toBe(150);
    expect(typeof dto.hourlyRate).toBe('number');
  });

  describe('days round-trip', () => {
    it('create persists days value', async () => {
      const created = await service.create({ name: 'Покраска', days: 3, hourlyRate: 0 });
      expect(created.days).toBe(3);
    });

    it('create allows null days (stuck path)', async () => {
      const created = await service.create({ name: 'Сборка', days: null, hourlyRate: 0 });
      expect(created.days).toBeNull();
    });

    it('create without days leaves days undefined (legacy default null)', async () => {
      const created = await service.create({ name: 'Раскрой', hourlyRate: 100 });
      expect(created.days).toBeUndefined();
      expect(created.hourlyRate).toBe(100);
    });

    it('update changes days and persists null explicitly', async () => {
      const doc = model.makeDoc({
        _id: new Types.ObjectId(),
        name: 'Сварка',
        days: 5,
        hourlyRate: 0,
      });
      const updated = await service.update(String(doc._id), { days: 8, hourlyRate: 0 });
      expect(updated.days).toBe(8);

      const cleared = await service.update(String(doc._id), { days: null, hourlyRate: 0 });
      expect(cleared.days).toBeNull();
    });

    it('update without days key keeps existing days', async () => {
      const doc = model.makeDoc({
        _id: new Types.ObjectId(),
        name: 'Сварка',
        days: 5,
        hourlyRate: 50,
      });
      const updated = await service.update(String(doc._id), { hourlyRate: 120 });
      expect(updated.days).toBe(5);
      expect(updated.hourlyRate).toBe(120);
    });

    it('404 on unknown id', async () => {
      await expect(
        service.update(String(new Types.ObjectId()), { days: 2, hourlyRate: 0 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('legacy doc without days still opens (backward compat)', async () => {
      const legacy = model.makeDoc({ _id: new Types.ObjectId(), name: 'Старый' });
      const found = await service.findById(String(legacy._id));
      expect(found.name).toBe('Старый');
      expect(found.days).toBeUndefined();
    });
  });

  describe('TZ-COST-301 hourlyRate backfill', () => {
    it('onModuleInit sets hourlyRate=0 when missing', async () => {
      model.makeDoc({ _id: new Types.ObjectId(), name: 'Legacy' });
      model.updateMany = jest.fn(() => ({
        exec: jest.fn(async () => ({ modifiedCount: 1, matchedCount: 1 })),
      }));
      await service.onModuleInit();
      expect(model.updateMany).toHaveBeenCalled();
    });
  });
});
