/**
 * TZ-105.2 — BomComponentResolveService
 *
 * Idempotent migration of orphan `productComponentId` references inside BOM
 * documents. Triggered at application bootstrap via `OnApplicationBootstrap`
 * lifecycle hook (DI graph fully resolved at this point, so both `BomModel`
 * and `ProductModuleModel` are available).
 *
 * Cascade (per TZ-105.2 spec §4.2):
 *   1. **Direct** — orphan's productComponentId DOES resolve to an existing
 *      `ProductModule` document → no-op (invariant already preserved).
 *   2. **Fuzzy** — orphan's productComponentId does NOT resolve, BUT a
 *      unique-matching `ProductModule` is found by `name === comp.notes`
 *      (trimmed, case-sensitive exact equality) → update
 *      bom.component.productComponentId to the new ProductModule._id.
 *   3. **Soft-detach** — neither direct nor fuzzy → set productComponentId
 *      to null, append `[orphan-resolved TZ-105.2]` to comp.notes for audit.
 *
 * Dry-run: `BOM_MIGRATE_DRY_RUN=true` (default) → log only, no DB writes.
 * To apply: `BOM_MIGRATE_DRY_RUN=false node dist/main.js`.
 *
 * SAFETY: failure is logged + swallowed at the lifecycle hook. Per-bom
 * iteration is wrapped in try/catch so one corrupted BOM does not abort
 * the entire migration (cursor leak hardening, sees TZF-00 cursor hygiene).
 *
 * Idempotency: re-running on a partially-migrated DB finds no orphans left
 * (soft-detach sets productComponentId to null → next pass skips).
 */

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Bom, BomDocument } from '../bom.schema';
import { ProductModule, ProductModuleDocument } from '../../product-module/product-module.schema';

export interface ResolveSummary {
  inspected: number;
  orphansFound: number;
  directMatches: number;
  fuzzyResolved: number;
  softDetached: number;
  errorsSwallowed: number;
  dryRun: boolean;
}

export interface ResolveOptions {
  dryRun?: boolean;
}

interface BomComponentLike {
  _id?: Types.ObjectId;
  productComponentId?: Types.ObjectId | null;
  quantity: number;
  notes?: string;
}

@Injectable()
export class BomComponentResolveService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BomComponentResolveService.name);

  constructor(
    @InjectModel(Bom.name) private readonly bomModel: Model<BomDocument>,
    @InjectModel(ProductModule.name)
    private readonly pmModel: Model<ProductModuleDocument>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const dryRun = process.env.BOM_MIGRATE_DRY_RUN !== 'false';
    try {
      const summary = await this.resolveOrphans({ dryRun });
      const verb = dryRun ? '[dry-run]' : '[applied]';
      this.logger.log(
        `${verb} bom.resolve summary: ` +
          `inspected=${summary.inspected}, ` +
          `orphans=${summary.orphansFound}, ` +
          `direct=${summary.directMatches}, ` +
          `fuzzy=${summary.fuzzyResolved}, ` +
          `softDetached=${summary.softDetached}, ` +
          `errorsSwallowed=${summary.errorsSwallowed}`,
      );
    } catch (err) {
      // NEVER block bootstrap (TZ-105 §10 R-2 mitigation)
      this.logger.error(
        `bom.resolve failed (bootstrap continues, no DB changes): ${
          (err as Error).message
        }`,
      );
    }
  }

  /**
   * Public testable entry-point (separate from lifecycle hook so unit-tests
   * can call it directly without bootstrapping the full Nest app).
   */
  async resolveOrphans(opts: ResolveOptions = {}): Promise<ResolveSummary> {
    const dryRun = opts.dryRun ?? process.env.BOM_MIGRATE_DRY_RUN !== 'false';

    const summary: ResolveSummary = {
      inspected: 0,
      orphansFound: 0,
      directMatches: 0,
      fuzzyResolved: 0,
      softDetached: 0,
      errorsSwallowed: 0,
      dryRun,
    };

    const cursor = this.bomModel
      .find({ 'components.0': { $exists: true } })
      .cursor();

    for await (const bom of cursor) {
      try {
        summary.inspected++;
        await this.resolveBom(bom, summary, dryRun);
      } catch (err) {
        // Per-bom isolation: one corrupted doc does NOT abort the migration.
        // Cursor stays open, next iteration proceeds.
        summary.errorsSwallowed++;
        this.logger.error(
          `bom=${String(bom?._id)} resolve failed (skipped): ${
            (err as Error).message
          }`,
        );
      }
    }

    return summary;
  }

  private async resolveBom(
    bom: BomDocument,
    summary: ResolveSummary,
    dryRun: boolean,
  ): Promise<void> {
    const components = (bom.components ?? []) as BomComponentLike[];
    const dirty: BomComponentLike[] = [];

    for (const comp of components) {
      // Skip null refs (already soft-detached; idempotent re-run safe).
      // Use truthiness check — undefined OR null both fall through.
      if (!comp.productComponentId) continue;

      // Stage 1 — direct lookup
      const exists = await this.pmModel.exists({
        _id: comp.productComponentId,
      });
      if (exists) {
        summary.directMatches++;
        continue;
      }

      // Orphan confirmed.
      summary.orphansFound++;

      // Stage 2 — fuzzy resolve by notes (unique ProductModule.name match)
      const fuzzy = await this.tryFuzzyResolve(comp);
      if (fuzzy) {
        if (!dryRun) {
          comp.productComponentId = fuzzy;
          dirty.push(comp);
        }
        summary.fuzzyResolved++;
        this.logger.warn(
          `bom=${bom._id} component=${String(comp._id)}: ` +
            `orphan resolved via fuzzy match (new productComponentId=${String(
              fuzzy,
            )})`,
        );
        continue;
      }

      // Stage 3 — soft-detach
      if (!dryRun) {
        comp.productComponentId = null;
        comp.notes = comp.notes
          ? `${comp.notes} [orphan-resolved 2026-07-12 TZ-105.2]`
          : '[orphan-resolved 2026-07-12 TZ-105.2]';
        dirty.push(comp);
      }
      summary.softDetached++;
      this.logger.warn(
        `bom=${bom._id} component=${String(comp._id)}: ` +
          `orphan soft-detached (no fuzzy match available)`,
      );
    }

    if (dirty.length > 0 && !dryRun) {
      await bom.save();
    }
  }

  /**
   * Single fuzzy match on `pm.name === comp.notes.trim()`. Returns the
   * matching ProductModule._id ONLY if exactly one match exists (avoids
   * ambiguous name collisions). `.trim()` defends against BOM-side
   * whitespace noise from user-entered notes.
   */
  private async tryFuzzyResolve(
    comp: BomComponentLike,
  ): Promise<Types.ObjectId | null> {
    const note = comp.notes?.trim();
    if (!note) return null;
    const matches = await this.pmModel
      .find({ name: note })
      .select({ _id: 1 })
      .limit(2)
      .lean()
      .exec();
    if (matches.length !== 1) return null;
    return matches[0]._id as Types.ObjectId;
  }
}
