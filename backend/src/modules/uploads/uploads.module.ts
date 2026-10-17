import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TemplateBlock,
  TemplateBlockSchema,
} from '../template-block/template-block.schema';
import { UploadsOrphanSweepService } from './uploads-orphan-sweep.service';

/**
 * TZ-DOC-STUDIO-1801 — orphan upload hygiene (scheduled sweep).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TemplateBlock.name, schema: TemplateBlockSchema },
    ]),
  ],
  providers: [UploadsOrphanSweepService],
  exports: [UploadsOrphanSweepService],
})
export class UploadsModule {}
