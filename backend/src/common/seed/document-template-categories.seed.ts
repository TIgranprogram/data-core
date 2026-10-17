import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DocumentTemplateCategory,
  DocumentTemplateCategoryDocument,
} from '../../modules/document-template-category/document-template-category.schema';
import { SYSTEM_DEFAULT_CATEGORY_SLUG } from '../../modules/document-template-category/document-template-category.service';

/**
 * TZ-DOC-307 — system default document-template category.
 *
 * Ensures a global (system) active default «Общее» exists on every boot.
 * The service's `resolveDefault()` falls back to it, so a brand-new
 * database can already create templates without a categoryId — the
 * server-side default contract works out of the box.
 *
 * Idempotent: the compound unique index {organizationId, slug} (null org
 * for system records) prevents duplicates; we also check existence first.
 *
 * Lifecycle: TZ-DOC-322 normalizes the seed-class lifecycle contract to
 * `OnModuleInit` to match `TextBlockCategoriesSeed` (TZ-DOC-321). Both
 * lifecycle hooks fire during `app.init()` and produce the same
 * observable end-state for an idempotent system seed; the earlier
 * `OnApplicationBootstrap` shape was historically distinct because
 * the document-template pipeline needed bootstrap-completed modules.
 * Today `OnModuleInit` is sufficient — the schema token is registered
 * synchronously in the constructor.
 */
@Injectable()
export class DocumentTemplateCategoriesSeed implements OnModuleInit {
  private readonly logger = new Logger(DocumentTemplateCategoriesSeed.name);

  constructor(
    @InjectModel(DocumentTemplateCategory.name)
    private readonly model: Model<DocumentTemplateCategoryDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.model
      .findOne({ slug: SYSTEM_DEFAULT_CATEGORY_SLUG })
      .exec();
    if (existing) return;

    await this.model.create({
      name: 'Общее',
      slug: SYSTEM_DEFAULT_CATEGORY_SLUG,
      description: 'Системная категория по умолчанию',
      isActive: true,
      isDefault: true,
      isSystem: true,
      sortOrder: 0,
      // organizationId intentionally absent → system (global) scope.
    });
    this.logger.log(
      `DocumentTemplateCategory seeded: system «Общее» (${SYSTEM_DEFAULT_CATEGORY_SLUG})`,
    );
  }
}
