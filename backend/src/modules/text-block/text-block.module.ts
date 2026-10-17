import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TextBlock, TextBlockSchema } from './text-block.schema';
import { TextBlockService } from './text-block.service';
import { TextBlockController } from './text-block.controller';
import { TextBlockCategoryModule } from '../text-block-category/text-block-category.module';

/**
 * TZ-86 Phase A.1 — TextBlockModule.
 *
 * Registers TextBlock model + service + controller. Exports TextBlockService
 *  + MongooseModule for downstream consumers (Phase A.4 DocumentBuilder will
 *  likely use TextBlockService for resolving text-block snippets to embed
 *  into TemplateBlock documents).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TextBlock.name, schema: TextBlockSchema },
    ]),
    TextBlockCategoryModule,
  ],
  controllers: [TextBlockController],
  providers: [TextBlockService],
  exports: [TextBlockService, MongooseModule],
})
export class TextBlockModule {}
