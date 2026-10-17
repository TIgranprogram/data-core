import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Material, MaterialSchema } from '../material/material.schema';
import { Product, ProductSchema } from '../product/product.schema';
import { ProductModule, ProductModuleSchema } from '../product-module/product-module.schema';
import { Attachment, AttachmentSchema } from './attachment.schema';
import { AttachmentService } from './attachment.service';
import { AttachmentController } from './attachment.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Attachment.name, schema: AttachmentSchema },
      { name: Product.name, schema: ProductSchema },
      { name: ProductModule.name, schema: ProductModuleSchema },
      { name: Material.name, schema: MaterialSchema },
    ]),
  ],
  controllers: [AttachmentController],
  providers: [AttachmentService],
  exports: [AttachmentService, MongooseModule],
})
export class AttachmentModule {}
