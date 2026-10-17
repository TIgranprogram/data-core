import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StudioDocument, StudioDocumentSchema } from '../studio-document/studio-document.schema';
import { TemplateBlock, TemplateBlockSchema } from './template-block.schema';
import { TemplateBlockService } from './template-block.service';
import { TemplateBlockController } from './template-block.controller';
import { SessionRunner } from '../../common/db/session-runner';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TemplateBlock.name, schema: TemplateBlockSchema },
      { name: StudioDocument.name, schema: StudioDocumentSchema },
    ]),
  ],
  controllers: [TemplateBlockController],
  providers: [TemplateBlockService, SessionRunner],
  exports: [TemplateBlockService, MongooseModule],
})
export class TemplateBlockModule {}
