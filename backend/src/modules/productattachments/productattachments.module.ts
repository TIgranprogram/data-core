import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from '../../common/catalog/product.schema';
import { Income, IncomeSchema } from '../incomes/income.schema';
import { AttachmentUploadGuard } from './attachment-upload.guard';
import { IncomeAttachmentUploadGuard } from './income-attachment-upload.guard';
import { IncomeAttachmentsService } from './income-attachments.service';
import { OrderAttachmentsService } from './order-attachments.service';
import { IncomeAttachmentsController, OrderAttachmentsController, OrderAttachmentsZipController, ProductAttachmentFileController, ProductAttachmentsController } from './productattachments.controller';
import { ProductAttachmentsService } from './productattachments.service';
import { ProductAttachment, ProductAttachmentSchema } from './productattachment.schema';

/** /api/products/:id/attachments — вложения изделия (`productattachments`), файлы в uploads/attachments (не раздаются статикой). */
@Module({
  imports: [MongooseModule.forFeature([{ name: ProductAttachment.name, schema: ProductAttachmentSchema }, { name: Product.name, schema: ProductSchema }, { name: Income.name, schema: IncomeSchema }])],
  controllers: [ProductAttachmentsController, ProductAttachmentFileController, IncomeAttachmentsController, OrderAttachmentsController, OrderAttachmentsZipController],
  providers: [ProductAttachmentsService, IncomeAttachmentsService, OrderAttachmentsService, AttachmentUploadGuard, IncomeAttachmentUploadGuard],
  exports: [ProductAttachmentsService],
})
export class ProductAttachmentsModule {}
