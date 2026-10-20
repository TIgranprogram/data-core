/**
 * TZ-240 schema-field-presence + wiring smoke tests.
 *
 * Round-2 of code-reviewer identified risk that field-only assertions won't
 * catch typos or accidentally-removed @Prop options. These tests assert
 * both field presence AND key wiring options:
 *  - organizationId: indexed with sparse:true (per project pattern from TZ-238)
 *  - isSystem: defaults to false at create time
 *
 * Round-2 round-3 (PASS-WITH-MINOR): migration has no transaction wrapper.
 * That's documented in TZ-240.A follow-up scope (deferred to next session).
 */
import { ProductSchema } from './product.schema';
import { MaterialSchema } from '../material/material.schema';
import { CategorySchema } from '../category/category.schema';

type SchemaPath = { options: Record<string, unknown>; path?: string };

describe('TZ-240 schema field + wiring presence', () => {
  it('Product: organizationId is sparse-indexed; isSystem defaults to false', () => {
    const paths = ProductSchema.paths as unknown as Record<string, SchemaPath>;
    const orgId = paths.organizationId;
    const isSystem = paths.isSystem;
    expect(orgId).toBeDefined();
    expect(orgId.options).toBeDefined();
    expect(orgId.options.sparse).toBe(true);
    expect(orgId.options.index).toBe(true);
    expect(orgId.options.required).toBe(false);

    expect(isSystem).toBeDefined();
    expect(isSystem.options).toBeDefined();
    expect(isSystem.options.default).toBe(false);
  });

  it('Material: organizationId is sparse-indexed; isSystem defaults to false', () => {
    const paths = MaterialSchema.paths as unknown as Record<string, SchemaPath>;
    expect(paths.organizationId.options.sparse).toBe(true);
    expect(paths.organizationId.options.index).toBe(true);
    expect(paths.organizationId.options.required).toBe(false);
    expect(paths.isSystem.options.default).toBe(false);
  });

  it('Category: organizationId is sparse-indexed; isSystem defaults to false', () => {
    const paths = CategorySchema.paths as unknown as Record<string, SchemaPath>;
    expect(paths.organizationId.options.sparse).toBe(true);
    expect(paths.organizationId.options.index).toBe(true);
    expect(paths.organizationId.options.required).toBe(false);
    expect(paths.isSystem.options.default).toBe(false);
  });
});
