import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  TextBlockCategory,
  TextBlockCategoryDocument,
  SYSTEM_DEFAULT_TEXT_BLOCK_CATEGORY_SLUG,
} from '../../modules/text-block-category/text-block-category.schema';

/**
 * TZ-DOC-315 + TZ-DOC-321 — Idempotent system-default seed for
 * text-block categories.
 *
 * Ensures a global (system) active default «Общее» exists on every boot
 * so the text-block catalog has at least one row, even on a fresh
 *      database, so the picker dropdown (TZ-DOC-316/317) and the server-side
 * `resolveDefault(organizationId)` ladder (TZ-DOC-320) both have a target.
 *
 * Idempotent: a `findOne({ slug })` check first; the unique index
 * `{ organizationId, slug }` (null org records excluded) is a defensive
 * backstop against concurrent inserts.
 *
 * NOTE: the original (TZ-DOC-315) seed file stored the Cyrillic `name`,
 * `description`, and guillemet log brackets using a mix of CP1251 bytes
 * and UTF-8 bytes, depending on the field. The encoding is preserved as
 * `«Общее»` (UTF-8) once and for all in TZ-DOC-321 — `write_file` emits
 * pure UTF-8 regardless of the OS-default editor of the committer.
 *
 * Lifecycle: `OnModuleInit` (matches original TZ-DOC-315 contract).
 * DocumentTemplateCategoriesSeed uses `OnApplicationBootstrap` rather
 * than `OnModuleInit`; both fire during app.init() and both produce the
 * same observable end-state for an idempotent system seed. Documented
 * in the archive marker so a future TZ can decide whether to migrate.
 */
@Injectable()
export class TextBlockCategoriesSeed implements OnModuleInit {
  private readonly logger = new Logger(TextBlockCategoriesSeed.name);

  constructor(
    @InjectModel(TextBlockCategory.name)
    private readonly model: Model<TextBlockCategoryDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.model
      .findOne({ slug: SYSTEM_DEFAULT_TEXT_BLOCK_CATEGORY_SLUG })
      .exec();
    if (existing) {
      // Repair soft-broken system row (inactive / not default) so resolveDefault works.
      let repaired = false;
      if (!existing.isActive) {
        existing.isActive = true;
        repaired = true;
      }
      if (!existing.isDefault) {
        existing.isDefault = true;
        repaired = true;
      }
      if (!existing.isSystem) {
        existing.isSystem = true;
        repaired = true;
      }
      if (repaired) {
        await existing.save();
        this.logger.log(
          `Repaired system default «${SYSTEM_DEFAULT_TEXT_BLOCK_CATEGORY_SLUG}» (active/default/system)`,
        );
      } else {
        this.logger.log(
          `System default «${SYSTEM_DEFAULT_TEXT_BLOCK_CATEGORY_SLUG}» already present, skip`,
        );
      }
      return;
    }
    await this.model.create({
      // organizationId intentionally absent → system (global) scope.
      name: 'Общее',
      slug: SYSTEM_DEFAULT_TEXT_BLOCK_CATEGORY_SLUG,
      isSystem: true,
      isActive: true,
      isDefault: true,
      sortOrder: 0,
      description:
        'Системная категория по умолчанию для текстовых блоков. Видна всем организациям.',
    });
    this.logger.log(
      `Inserted text-block category «${SYSTEM_DEFAULT_TEXT_BLOCK_CATEGORY_SLUG}»`,
    );
  }
}
