import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DocType, DocTypeSchema } from './doc-type.schema';
import { DocTypeService } from './doc-type.service';
import { DocTypeController } from './doc-type.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: DocType.name, schema: DocTypeSchema }])],
  controllers: [DocTypeController],
  providers: [DocTypeService],
  exports: [DocTypeService, MongooseModule],
})
export class DocTypeModule {}
