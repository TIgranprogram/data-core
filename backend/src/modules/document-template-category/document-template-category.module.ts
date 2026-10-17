import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DocumentTemplateCategory,
  DocumentTemplateCategorySchema,
} from './document-template-category.schema';
import { DocumentTemplateCategoryService } from './document-template-category.service';
import { DocumentTemplateCategoryController } from './document-template-category.controller';
import {
  DocumentTemplate,
  DocumentTemplateSchema,
} from '../document-template/document-template.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DocumentTemplateCategory.name, schema: DocumentTemplateCategorySchema },
      // The service counts template references before deleting a category.
      { name: DocumentTemplate.name, schema: DocumentTemplateSchema },
    ]),
  ],
  controllers: [DocumentTemplateCategoryController],
  providers: [DocumentTemplateCategoryService],
  exports: [DocumentTemplateCategoryService, MongooseModule],
})
export class DocumentTemplateCategoryModule {}
