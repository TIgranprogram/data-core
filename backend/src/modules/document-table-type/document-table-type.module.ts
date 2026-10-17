import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DocumentTableType, DocumentTableTypeSchema } from './document-table-type.schema';
import { DocumentTableTypeService } from './document-table-type.service';
import { DocumentTableTypeController } from './document-table-type.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: DocumentTableType.name, schema: DocumentTableTypeSchema }])],
  controllers: [DocumentTableTypeController],
  providers: [DocumentTableTypeService],
  exports: [DocumentTableTypeService, MongooseModule],
})
export class DocumentTableTypeModule {}
