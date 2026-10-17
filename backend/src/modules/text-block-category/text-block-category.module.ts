import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TextBlockCategory,
  TextBlockCategorySchema,
} from './text-block-category.schema';
import { TextBlockCategoryService } from './text-block-category.service';
import { TextBlockCategoryController } from './text-block-category.controller';
import { TextBlock, TextBlockSchema } from '../text-block/text-block.schema';

/**
 * TZ-DOC-315 — TextBlockCategoryModule.
 *
 * Registers:
 *   - TextBlockCategory schema (own entity).
 *   - TextBlock schema (referenced by the service when counting how many
 *     blocks use a category before allowing delete — see
 *     `TextBlockCategoryService.remove`).
 *
 * The TextBlock schema is registered here for the @InjectModel token only;
 * no module-level import is created, so there is NO circular dependency
 * with `TextBlockModule` (which imports THIS module for the service).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TextBlockCategory.name, schema: TextBlockCategorySchema },
      { name: TextBlock.name, schema: TextBlockSchema },
    ]),
  ],
  controllers: [TextBlockCategoryController],
  providers: [TextBlockCategoryService],
  exports: [TextBlockCategoryService, MongooseModule],
})
export class TextBlockCategoryModule {}
