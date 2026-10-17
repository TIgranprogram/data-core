import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ColorReference,
  ColorReferenceDocument,
  SYSTEM_DEFAULT_COLOR_SLUG,
} from '../../modules/color-reference/color-reference.schema';

/**
 * TZ-PRODUCTS-301 — system default color reference («Не выбран»).
 *
 * Ensures a global (system) active default color exists on every boot. The
 * product form dialog (TZ-PRODUCTS-302) offers it as the explicit "no color
 * chosen" option; `resolveDefault()` falls back to it, so a brand-new
 * database can already reference the default without manual setup.
 *
 * Idempotent: the compound unique index {organizationId, slug} (null org for
 * system records) prevents duplicates; we also check existence first.
 *
 * NOTE: Cyrillic literals are written as UTF-8 source (write_file). Do NOT
 * copy the CP1251-encoded seed body from text-block-categories.seed.ts —
 * that file carries corrupted «�» replacement characters.
 */
@Injectable()
export class ColorReferencesSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(ColorReferencesSeed.name);

  constructor(
    @InjectModel(ColorReference.name)
    private readonly model: Model<ColorReferenceDocument>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const existing = await this.model
      .findOne({ slug: SYSTEM_DEFAULT_COLOR_SLUG })
      .exec();
    if (existing) return;

    await this.model.create({
      name: 'Не выбран',
      slug: SYSTEM_DEFAULT_COLOR_SLUG,
      hex: '#9CA3AF',
      description: 'Системный цвет по умолчанию — цвет не выбран',
      isActive: true,
      isDefault: true,
      isSystem: true,
      // organizationId intentionally absent → system (global) scope.
    });
    this.logger.log(
      `ColorReference seeded: system «Не выбран» (${SYSTEM_DEFAULT_COLOR_SLUG})`,
    );
  }
}
