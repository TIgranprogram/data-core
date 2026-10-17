import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TableTemplate, TableTemplateSchema } from './table-template.schema';
import { TableTemplateService } from './table-template.service';
import { TableTemplateController } from './table-template.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: TableTemplate.name, schema: TableTemplateSchema }])],
  controllers: [TableTemplateController],
  providers: [TableTemplateService],
  exports: [TableTemplateService, MongooseModule],
})
export class TableTemplateModule {}
