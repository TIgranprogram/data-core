import { createTestApp, TestContext } from '../setup/test-db';
import { SYSTEM_DEFAULT_TEXT_BLOCK_CATEGORY_SLUG } from '../../src/modules/text-block-category/text-block-category.schema';

/**
 * TZ-DOC-321 — prove TextBlockCategoriesSeed actually runs after
 * `app.init()`. Closes the TZ-DOC-320 wire-up contract gap: the seed
 * file existed since TZ-DOC-315 but `app.module.ts` never registered
 * it as a provider, so `text_block_categories` was empty on every
 * bootstrap and `resolveDefault(null)` returned null.
 *
 * The previous cure was `TextBlockService.ensureSystemDefault()`
 * (TZ-DOC-320); wiring the seed restores the canonical Nautilus
 * pattern (DocumentTemplateCategoriesSeed + TextBlockCategoriesSeed
 * both run on init).
 */
describe('TextBlockCategoriesSeed wiring (TZ-DOC-321)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    // createTestApp() calls app.init() internally — that triggers
    // OnModuleInit on TextBlockCategoriesSeed.
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('inserts a system-active-default category row after app.init()', async () => {
    // Query the raw MongoDB collection directly (no Mongoose cast) — we
    // want to verify what was actually stored by the seed, not what the
    // hydrated schema returns. The query filters by boolean flags to
    // avoid accidentally matching future non-system categories.
    const docs = await ctx.connection
      .collection('text_block_categories')
      .find({ isSystem: true, isActive: true, isDefault: true })
      .toArray();
    // At least one system category must exist after init.
    expect(docs.length).toBeGreaterThanOrEqual(1);
    // And it must be the canonical «Общее» (slug ASCII-only, so
    // encoding is irrelevant for the lookup key).
    expect(docs.map((d) => d.slug)).toContain(
      SYSTEM_DEFAULT_TEXT_BLOCK_CATEGORY_SLUG,
    );
  });
});
