import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from '../../common/catalog/product.schema';
import { AttachmentUploadGuard } from './attachment-upload.guard';
import { OrderAttachmentsService } from './order-attachments.service';
import { OrderAttachmentsController, OrderAttachmentsZipController, ProductAttachmentFileController, ProductAttachmentsController } from './productattachments.controller';
import { ProductAttachmentsService } from './productattachments.service';
import { ProductAttachment, ProductAttachmentSchema } from './productattachment.schema';

/** /api/products/:id/attachments — вложения изделия (`productattachments`), файлы в uploads/attachments (не раздаются статикой). */
@Module({
  imports: [MongooseModule.forFeature([{ name: ProductAttachment.name, schema: ProductAttachmentSchema }, { name: Product.name, schema: ProductSchema }])],
  controllers: [ProductAttachmentsController, ProductAttachmentFileController, OrderAttachmentsController, OrderAttachmentsZipController],
  providers: [ProductAttachmentsService, OrderAttachmentsService, AttachmentUploadGuard],
  exports: [ProductAttachmentsService],
})
export class ProductAttachmentsModule {}
