import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BomComponentResolveService } from './bom-component-resolve.service';
import { Bom } from '../bom.schema';
import { ProductModule } from '../../product-module/product-module.schema';

/**
 * TZ-105.2 spec §4.2 — cascade test cases (extended per reviewer feedback):
 *   - Case A (direct): orphan's productComponentId points to a VALID
 *     existing ProductModule → resolved to 0 actions (already correct).
 *   - Case B (fuzzy unique): orphan ref + uniquely-named PM match →
 *     productComponentId is UPDATED to the new ProductModule._id.
 *   - Case C (soft-detach): orphan + no fuzzy match → productComponentId is
 *     set to null; notes has audit marker appended.
 *   - Case D (non-unique fuzzy): orphan ref + 2 PMs sharing the same name
 *     → fuzzy pass returns null (per `matches.length !== 1`) → component
 *     falls through to soft-detach path.
 *   - Plus 3 edge cases: dry-run (no DB writes), empty store, null-skip.
 */

describe('BomComponentResolveService (TZ-105.2)', () => {
  let service: BomComponentResolveService;
  let mockBomModel: any;
  let mockPmModel: any;
  let savedDocs: any[] = [];

  /**
   * In-memory BOM store for the test. Each cursor() call yields docs from
   * this list; .save() pushes mutated docs into `savedDocs` for assertions.
   */
  let bomStore: any[];

  /**
   * In-memory ProductModule store keyed by `_id`. `.exists({_id})` checks
   * membership; `.find({name})` returns up to 2 matches.
   */
  let pmStore: Map<string, any>;

  function makeBom(components: any[]): any {
    return {
      _id: new Types.ObjectId(),
      components,
      save: jest.fn(async function () {
        savedDocs.push(this);
      }),
    };
  }

  function makePm(name: string, _id?: Types.ObjectId): any {
    return { _id: _id ?? new Types.ObjectId(), name };
  }

  function cursorOf<T>(arr: T[]): any {
    return {
      [Symbol.asyncIterator]: async function* () {
        for (const item of arr) yield item;
      },
    };
  }

  beforeEach(async () => {
    savedDocs = [];
    bomStore = [];
    pmStore = new Map();

    mockBomModel = {
      find: jest.fn(() => ({ cursor: () => cursorOf(bomStore) })),
    };

    mockPmModel = {
      exists: jest.fn(async (q: any) => {
        return pmStore.has(String(q._id)) ? { _id: q._id } : null;
      }),
      find: jest.fn((q: any) => ({
        select: () => ({
          limit: () => ({
            lean: () => ({
              exec: async () => {
                const matches: any[] = [];
                for (const pm of pmStore.values()) {
                  if (pm.name === q.name) matches.push(pm);
                  if (matches.length >= 2) break;
                }
                return matches;
              },
            }),
          }),
        }),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BomComponentResolveService,
        { provide: getModelToken(Bom.name), useValue: mockBomModel },
        {
          provide: getModelToken(ProductModule.name),
          useValue: mockPmModel,
        },
      ],
    }).compile();

    service = module.get(BomComponentResolveService);
  });

  it('Case A — direct match: existing productComponentId is preserved (no-op)', async () => {
    const pm = makePm('Болт М8');
    pmStore.set(String(pm._id), pm);

    bomStore.push(
      makeBom([
        {
          _id: new Types.ObjectId(),
          productComponentId: pm._id, // points to the PM that's in pmStore (direct + no-op)
          quantity: 1,
          notes: 'Болт М8',
        },
      ]),
    );

    const summary = await service.resolveOrphans({ dryRun: false });

    expect(summary.inspected).toBe(1);
    expect(summary.orphansFound).toBe(0);
    expect(summary.directMatches).toBe(1);
    expect(summary.fuzzyResolved).toBe(0);
    expect(summary.softDetached).toBe(0);
    expect(savedDocs).toHaveLength(0); // no DB writes triggered
  });

  it('Case B — fuzzy match (unique): orphan ref replaced with uniquely-named PM + trim normalization', async () => {
    // orphan ref (non-existent in PM store)
    const orphanRef = new Types.ObjectId();
    // uniquely matching PM
    const pm = makePm('Болт М8');
    pmStore.set(String(pm._id), pm);

    const bom = makeBom([
      {
        _id: new Types.ObjectId(),
        productComponentId: orphanRef,
        quantity: 4,
        // Has trailing whitespace — should be trimmed before fuzzy match
        notes: '   Болт М8   ',
      },
    ]);
    bomStore.push(bom);

    const summary = await service.resolveOrphans({ dryRun: false });

    expect(summary.inspected).toBe(1);
    expect(summary.orphansFound).toBe(1);
    expect(summary.fuzzyResolved).toBe(1);
    expect(summary.softDetached).toBe(0);
    expect(savedDocs).toHaveLength(1);
    expect(savedDocs[0].components[0].productComponentId).toEqual(pm._id);
    // Trim normalization is QUERY-only: the source notes field keeps its
    // whitespace verbatim (defends against accidental whitespace stripping).
    expect(savedDocs[0].components[0].notes).toBe('   Болт М8   ');
  });

  it('Case C — soft-detach: orphan with no fuzzy match → productComponentId=null, audit marker in notes', async () => {
    const orphanRef = new Types.ObjectId();
    // No PM matches name 'Болт М8' (pmStore is empty by default)

    const bom = makeBom([
      {
        _id: new Types.ObjectId(),
        productComponentId: orphanRef,
        quantity: 2,
        notes: 'Болт М8',
      },
    ]);
    bomStore.push(bom);

    const summary = await service.resolveOrphans({ dryRun: false });

    expect(summary.inspected).toBe(1);
    expect(summary.orphansFound).toBe(1);
    expect(summary.fuzzyResolved).toBe(0);
    expect(summary.softDetached).toBe(1);
    expect(savedDocs).toHaveLength(1);
    expect(savedDocs[0].components[0].productComponentId).toBeNull();
    expect(savedDocs[0].components[0].notes).toContain('Болт М8');
    expect(savedDocs[0].components[0].notes).toContain(
      '[orphan-resolved 2026-07-12 TZ-105.2]',
    );
  });

  it('Case D — non-unique fuzzy match: 2 PMs same name → soft-detach (no false positive)', async () => {
    // 2 PMs sharing the same name → uniqueness check fails → soft-detach
    pmStore.set(String(makePm('Болт М8')._id), makePm('Болт М8'));
    pmStore.set(String(makePm('Болт М8')._id), makePm('Болт М8'));

    const orphanRef = new Types.ObjectId();
    bomStore.push(
      makeBom([
        {
          _id: new Types.ObjectId(),
          productComponentId: orphanRef,
          quantity: 1,
          notes: 'Болт М8',
        },
      ]),
    );

    const summary = await service.resolveOrphans({ dryRun: false });

    expect(summary.orphansFound).toBe(1);
    expect(summary.fuzzyResolved).toBe(0); // uniqueness rejected
    expect(summary.softDetached).toBe(1); // falls through to soft-detach
    expect(savedDocs).toHaveLength(1);
    expect(savedDocs[0].components[0].productComponentId).toBeNull();
  });

  it('Dry-run: summary still computed, but no DB writes occur', async () => {
    const orphanRef = new Types.ObjectId();
    bomStore.push(
      makeBom([
        {
          _id: new Types.ObjectId(),
          productComponentId: orphanRef,
          quantity: 1,
          notes: undefined, // no fuzzy fallback possible → would soft-detach
        },
      ]),
    );

    const summary = await service.resolveOrphans({ dryRun: true });

    expect(summary.dryRun).toBe(true);
    expect(summary.softDetached).toBe(1);
    expect(savedDocs).toHaveLength(0); // critical: no save() fired in dry-run
  });

  it('Empty BOM store: no-op summary (inspected=0)', async () => {
    const summary = await service.resolveOrphans({ dryRun: false });
    expect(summary.inspected).toBe(0);
    expect(summary.orphansFound).toBe(0);
    expect(savedDocs).toHaveLength(0);
  });

  it('Already-detached component (productComponentId=null): skipped silently', async () => {
    bomStore.push(
      makeBom([
        {
          _id: new Types.ObjectId(),
          productComponentId: null, // already migrated
          quantity: 1,
          notes: 'Болт М8 [orphan-resolved 2026-07-12 TZ-105.2]',
        },
      ]),
    );
    const summary = await service.resolveOrphans({ dryRun: false });
    expect(summary.inspected).toBe(1);
    expect(summary.orphansFound).toBe(0); // null ref is skipped, not orphaned
    expect(savedDocs).toHaveLength(0);
  });

  it('Mixed BOM: 3 components → all 3 cascade paths exercised in single migration pass', async () => {
    // PM store: only 'Болт М8' (unique) + 'Шуруп 4х40' (unique)
    const bolt = makePm('Болт М8');
    pmStore.set(String(bolt._id), bolt);
    const screw = makePm('Шуруп 4х40');
    pmStore.set(String(screw._id), screw);

    bomStore.push(
      makeBom([
        // Direct: orphanRef points to existing bolt (placeholder; real test will set valid ref below)
        {
          _id: new Types.ObjectId(),
          productComponentId: bolt._id, // direct match
          quantity: 1,
          notes: 'Болт М8',
        },
        // Fuzzy: orphanRef + 'Шуруп 4х40' notes → fuzzy resolve to screw._id
        {
          _id: new Types.ObjectId(),
          productComponentId: new Types.ObjectId(), // orphan
          quantity: 2,
          notes: 'Шуруп 4х40',
        },
        // Soft-detach: orphanRef + 'НетТакогоИмени' notes → soft-detach
        {
          _id: new Types.ObjectId(),
          productComponentId: new Types.ObjectId(), // orphan
          quantity: 3,
          notes: 'НетТакогоИмени',
        },
      ]),
    );

    const summary = await service.resolveOrphans({ dryRun: false });

    expect(summary.inspected).toBe(1);
    expect(summary.directMatches).toBe(1);
    expect(summary.orphansFound).toBe(2);
    expect(summary.fuzzyResolved).toBe(1);
    expect(summary.softDetached).toBe(1);

    // DB write: BOM with 2 mutated components
    expect(savedDocs).toHaveLength(1);
    expect(savedDocs[0].components[0].productComponentId).toEqual(bolt._id);
    expect(savedDocs[0].components[1].productComponentId).toEqual(screw._id);
    expect(savedDocs[0].components[2].productComponentId).toBeNull();
    expect(savedDocs[0].components[2].notes).toContain(
      '[orphan-resolved 2026-07-12 TZ-105.2]',
    );
  });

  it('Per-bom error isolation: one corrupted BOM does not abort the migration', async () => {
    // First bom throws inside resolveBom (simulated via mockBomModel)
    const corrupt = {
      _id: new Types.ObjectId(),
      components: [{ productComponentId: new Types.ObjectId(), quantity: 1 }],
      // `save` throws when invoked
      save: jest.fn(async () => {
        throw new Error('mock-db-failure');
      }),
    };
    // Spy on .find to wrap corrupt bom in cursor
    mockBomModel.find = jest.fn(() => ({
      cursor: () =>
        (async function* () {
          yield corrupt;
          // Second bom: clean, should still process despite prior error
          yield makeBom([
            {
              _id: new Types.ObjectId(),
              productComponentId: new Types.ObjectId(),
              quantity: 1,
              notes: 'НетТакогоИмени', // orphan → soft-detach
            },
          ]);
        })(),
    }));

    const summary = await service.resolveOrphans({ dryRun: false });

    expect(summary.inspected).toBe(2);
    expect(summary.errorsSwallowed).toBe(1);
    // The corrupted bom's component is logically soft-detached BEFORE save()
    // throws in resolveBom() (Stage-3 already updated productComponentId and
    // notes; only the persistence step fails and is swallowed). So the
    // softDetached counter increments to 2 (corrupt + clean), mirroring the
    // same "decision-before-persist" semantics as resolveBom in dry-run mode.
    // softDetached === 2 AND errorsSwallowed === 1 are both correct.
    expect(summary.softDetached).toBe(2);
  });
});
