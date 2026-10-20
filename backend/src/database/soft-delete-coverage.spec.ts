/**
 * TZ-CORE-302 — Regression test: every *.schema.ts must have either
 * `deletedAt` field or `softDelete: false` in @Schema() decorator.
 *
 * This prevents future drift where a new schema is added without
 * opting in or out of the soft-delete plugin.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const BACKEND_SRC = join(__dirname, '..');

function findSchemaFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSchemaFiles(full));
    } else if (entry.name.endsWith('.schema.ts')) {
      results.push(full);
    }
  }
  return results;
}

describe('soft-delete coverage (TZ-CORE-302)', () => {
  const schemaFiles = findSchemaFiles(BACKEND_SRC);

  it('every *.schema.ts has deletedAt or softDelete: false', () => {
    const violations: string[] = [];

    for (const file of schemaFiles) {
      const content = readFileSync(file, 'utf-8');

      // Skip subdocuments — they don't have a collection-level @Schema
      if (content.includes('@Schema({ _id: false })') && !content.includes('collection:')) {
        continue;
      }

      const hasDeletedAt = content.includes('deletedAt');
      const hasOptOut = content.includes('softDelete: false');

      if (!hasDeletedAt && !hasOptOut) {
        violations.push(relative(BACKEND_SRC, file));
      }
    }

    expect(violations).toEqual([]);
  });
});
