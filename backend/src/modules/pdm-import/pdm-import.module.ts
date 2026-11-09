import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductModule as ProductModuleEntity, ProductModuleSchema } from '../../common/catalog/product-module.schema';
import { Product, ProductSchema } from '../../common/catalog/product.schema';
import { Material, MaterialSchema } from '../material/material.schema';
import { Photo, PhotoSchema } from '../photos/photo.schema';
import { PhotosModule } from '../photos/photos.module';
import { PdmFilesModule } from '../pdm-files/pdm-files.module';
import { PdmImportController } from './pdm-import.controller';
import { PdmImport, PdmImportSchema } from './pdm-import.schema';
import { PdmPreviewService } from './pdm-preview.service';
import { PdmImportService } from './pdm-import.service';

/** /api/pdm-import — загрузка изделий из PDM: предпросмотр, применение одной транзакцией, файлы (C057). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PdmImport.name, schema: PdmImportSchema },
      { name: Material.name, schema: MaterialSchema },
      { name: ProductModuleEntity.name, schema: ProductModuleSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Photo.name, schema: PhotoSchema },
    ]),
    PdmFilesModule,
    PhotosModule,
  ],
  controllers: [PdmImportController],
  providers: [PdmImportService, PdmPreviewService],
})
export class PdmImportModule {}
