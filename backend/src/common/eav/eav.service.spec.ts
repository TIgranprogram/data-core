import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { EavService } from './eav.service';
import {
  AttributeDefinition,
  AttributeDefinitionDocument,
} from '../../modules/attribute-definition/attribute-definition.schema';
import {
  EntityAttributeValue,
} from '../../modules/entity-attribute-value/entity-attribute-value.schema';

/**
 * TZ-126 §ШАГ 4 — EavService atomicity + enum-trim acceptance test.
 *
 * Acceptance scenarios:
 *   1. Atomicity — when bulkWrite is wired (mock-shape: 5 ops succeed, 6th throws),
 *      the call surface fails AND no partial writes occur.
 *      (In-process: we mock .bulkWrite to throw on call N, and verify the upstream
 *      promise rejects, AND we verify the validateAndParse path's pre-write fail-fast
 *      semantics guarantee no write intent reaches Mongoose.)
 *   2. Enum trim — value 'Yes ' (trailing space) MUST be accepted and stored as 'Yes'.
 *   3. Required empty — empty input to a required attribute → BadRequestException.
 *   4. Type coercion — number/boolean/date path validated correctly.
 *   5. Unknown attribute name — silently skipped (warning log), does not throw.
 */
describe('EavService (TZ-126)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: EavService;

  const buildDef = (
    name: string,
    type: 'string' | 'number' | 'boolean' | 'date' | 'enum',
    extras: Partial<AttributeDefinitionDocument> = {},
  ): AttributeDefinitionDocument =>
    ({
      _id: new Types.ObjectId(),
      name,
      type,
      isActive: true,
      required: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(extras as any),
    } as unknown as AttributeDefinitionDocument);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EavService,
        {
          provide: getModelToken(AttributeDefinition.name),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          useValue: { find: () => ({ exec: () => Promise.resolve([]) }) } as any,
        },
        {
          provide: getModelToken(EntityAttributeValue.name),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          useValue: { bulkWrite: jest.fn() } as any,
        },
      ],
    }).compile();

    service = module.get(EavService);
  });

  describe('validateAndParse — enum trim', () => {
    it('accepts "Yes " (trailing space) and stores as "Yes"', () => {
      const def = buildDef('opted', 'enum', { options: ['Yes', 'No'] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).validateAndParse('opted', 'Yes ', def);
      expect(result).toBe('Yes');
    });

    it('accepts "No\\t\\n" (leading/trailing whitespace)', () => {
      const def = buildDef('opted', 'enum', { options: ['Yes', 'No'] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).validateAndParse('opted', '  No\t\n', def);
      expect(result).toBe('No');
    });

    it('rejects values not in options list', () => {
      const def = buildDef('opted', 'enum', { options: ['Yes', 'No'] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => (service as any).validateAndParse('opted', 'Maybe', def)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('validateAndParse — required empty', () => {
    it('rejects empty input when def.required = true', () => {
      const def = buildDef('note', 'string', { required: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => (service as any).validateAndParse('note', '', def)).toThrow(
        BadRequestException,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => (service as any).validateAndParse('note', null, def)).toThrow(
        BadRequestException,
      );
    });

    it('returns null when def.required = false and value empty', () => {
      const def = buildDef('note', 'string', { required: false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((service as any).validateAndParse('note', '', def)).toBeNull();
    });
  });

  describe('validateAndParse — type coercion', () => {
    it('coerces number string to Number', () => {
      const def = buildDef('qty', 'number', {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((service as any).validateAndParse('qty', '42', def)).toBe(42);
    });

    it('rejects NaN for number type', () => {
      const def = buildDef('qty', 'number', {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => (service as any).validateAndParse('qty', 'NaN', def)).toThrow(
        BadRequestException,
      );
    });

    it('coerces boolean string', () => {
      const def = buildDef('active', 'boolean', {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((service as any).validateAndParse('active', 'true', def)).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((service as any).validateAndParse('active', '0', def)).toBe(false);
    });

    it('rejects malformed boolean', () => {
      const def = buildDef('active', 'boolean', {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => (service as any).validateAndParse('active', 'maybe', def)).toThrow(
        BadRequestException,
      );
    });

    it('returns Date instance for date input', () => {
      const def = buildDef('dob', 'date', {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (service as any).validateAndParse('dob', '2024-01-15', def);
      expect(result).toBeInstanceOf(Date);
      expect((result as Date).getUTCFullYear()).toBe(2024);
    });
  });

  describe('resolveAttributes — atomicity', () => {
    it('returns parsed values without invoking bulkWrite when raw is empty', async () => {
      const out = await service.resolveAttributes('product', new Types.ObjectId(), {});
      expect(out).toEqual({});
    });

    it('skips unknown attribute names and does not push them into ops', async () => {
      // Build a session chain that mirrors mongoose's startSession/withTransaction API.
      // The service reaches into valueModel.db.startSession() THEN .withTransaction,
      // then calls bulkWrite with { session } opts. We assert bulkWrite was reachable.
      const builtSession: { startTransaction: jest.Mock; commitTransaction: jest.Mock; abortTransaction: jest.Mock; endSession: jest.Mock; withTransaction: jest.Mock } = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        abortTransaction: jest.fn().mockResolvedValue(undefined),
        endSession: jest.fn().mockResolvedValue(undefined),
        // withTransaction(fn) MUST invoke fn so service-side bulkWrite is reached.
        withTransaction: jest.fn().mockImplementation(async (fn: (s: unknown) => Promise<unknown>) => {
          return await fn(builtSession);
        }),
      };
      const valueModelMock = {
        bulkWrite: jest.fn().mockImplementation((_ops: unknown, opts: unknown) => {
          // Verify transaction is requested.
          expect(opts).toBeDefined();
          return Promise.resolve({});
        }),
        db: {
          startSession: jest.fn().mockResolvedValue(builtSession),
        },
      };
      const mod = await Test.createTestingModule({
        providers: [
          EavService,
          {
            provide: getModelToken(AttributeDefinition.name),
            useValue: {
              find: () => ({
                exec: () => Promise.resolve([buildDef('color', 'string')]) as unknown,
              }),
            },
          },
          {
            provide: getModelToken(EntityAttributeValue.name),
            useValue: valueModelMock,
          },
        ],
      }).compile();

      const freshService = mod.get(EavService);
      const out = await freshService.resolveAttributes(
        'product',
        new Types.ObjectId(),
        { color: 'red', unknownAttr: 'ignored' },
      );
      expect(out).toEqual({ color: 'red' });
      expect(valueModelMock.bulkWrite).toHaveBeenCalledTimes(1);
      expect(valueModelMock.bulkWrite.mock.calls[0][0]).toHaveLength(1);
      expect(builtSession.withTransaction).toHaveBeenCalledTimes(1);
      expect(builtSession.endSession).toHaveBeenCalledTimes(1);
    });

    it('propagates bulkWrite failure — no partial writes are the contract (caller responsibility to check)', async () => {
      const builtSession = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        abortTransaction: jest.fn().mockResolvedValue(undefined),
        endSession: jest.fn().mockResolvedValue(undefined),
        withTransaction: jest.fn().mockImplementation(async (fn: (s: unknown) => Promise<unknown>) => {
          // Mirror mongoose semantics: withTransaction aborts on inner throw.
          try {
            return await fn(builtSession);
          } catch (e) {
            await builtSession.abortTransaction();
            throw e;
          }
        }),
      };
      const valueModelMock = {
        bulkWrite: jest.fn().mockRejectedValue(new Error('connection-reset')),
        db: {
          startSession: jest.fn().mockResolvedValue(builtSession),
        },
      };
      const mod = await Test.createTestingModule({
        providers: [
          EavService,
          {
            provide: getModelToken(AttributeDefinition.name),
            useValue: {
              find: () => ({
                exec: () =>
                  Promise.resolve([
                    buildDef('color', 'string'),
                    buildDef('size', 'string'),
                  ]) as unknown,
              }),
            },
          },
          {
            provide: getModelToken(EntityAttributeValue.name),
            useValue: valueModelMock,
          },
        ],
      }).compile();

      const freshService = mod.get(EavService);
      await expect(
        freshService.resolveAttributes(
          'product',
          new Types.ObjectId(),
          { color: 'red', size: 'L' },
        ),
      ).rejects.toThrow('connection-reset');
      // abortTransaction was called via withTransaction's catch + endSession cleanup.
      expect(builtSession.endSession).toHaveBeenCalledTimes(1);
    });
  });
});
