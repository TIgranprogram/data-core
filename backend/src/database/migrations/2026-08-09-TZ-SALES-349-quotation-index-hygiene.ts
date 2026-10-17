import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

export interface QuotationIndexInfo {
  name?: string;
  key?: Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
}

export interface TZSales349MigrationResult {
  inspected: QuotationIndexInfo[];
  dropped: string[];
  dropFailures: string[];
}

const CANONICAL_UNIQUE_INDEXES = new Set([
  'number_1',
  'masterId_1_organizationId_1',
]);

/**
 * TZ-SALES-349 — remove stale unique indexes left by old Quotation schemas.
 *
 * Mongoose autoIndex is disabled in production, so obsolete unique indexes
 * survive schema changes and can reject otherwise valid new drafts. The
 * migration deliberately touches only unique indexes outside the canonical
 * quotation set; ordinary helper indexes and canonical unique indexes stay.
 */
export async function runTZSales349QuotationIndexHygieneMigration(
  connection: Pick<Connection, 'collection'>,
): Promise<TZSales349MigrationResult> {
  const collection = connection.collection('quotations');
  let indexes: QuotationIndexInfo[];
  try {
    indexes = (await collection.indexes()) as QuotationIndexInfo[];
  } catch (error) {
    // An empty Mongo database may not have created the collection yet.
    if ((error as { code?: number }).code === 26) {
      return { inspected: [], dropped: [], dropFailures: [] };
    }
    throw error;
  }

  const result: TZSales349MigrationResult = {
    inspected: indexes,
    dropped: [],
    dropFailures: [],
  };

  for (const index of indexes) {
    console.log(
      `[TZ-SALES-349] quotation index ${index.name ?? '<unnamed>'} ` +
        `keys=${JSON.stringify(index.key ?? {})} unique=${index.unique === true} ` +
        `sparse=${index.sparse === true}`,
    );
    if (
      !index.unique ||
      !index.name ||
      CANONICAL_UNIQUE_INDEXES.has(index.name)
    )
      continue;

    try {
      await collection.dropIndex(index.name);
      result.dropped.push(index.name);
    } catch (error) {
      result.dropFailures.push(index.name);
      console.warn(
        `[TZ-SALES-349] could not drop quotation index ${index.name}: ${(error as Error).message}`,
      );
    }
  }

  return result;
}

/** Runs after the database connection is ready and never blocks application boot. */
@Injectable()
export class QuotationIndexHygieneMigration implements OnApplicationBootstrap {
  private readonly logger = new Logger(QuotationIndexHygieneMigration.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const result = await runTZSales349QuotationIndexHygieneMigration(
        this.connection,
      );
      this.logger.log(
        `quotations: inspected=${result.inspected.length}, ` +
          `dropped=${result.dropped.length ? result.dropped.join(',') : 'none'}, ` +
          `dropFailures=${result.dropFailures.length ? result.dropFailures.join(',') : 'none'}`,
      );
    } catch (error) {
      this.logger.error(
        `quotation index hygiene failed (bootstrap continues): ${(error as Error).message}`,
      );
    }
  }
}
