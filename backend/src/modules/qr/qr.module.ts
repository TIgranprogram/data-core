import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductSchema, Product } from '../../common/catalog/product.schema';
import { Material, MaterialSchema } from '../material/material.schema';
import { QrController, QrRedirectController } from './qr.controller';
import { QrCode, QrCodeSchema } from './qr.schema';
import { QrService } from './qr.service';

/** /api/qr — QR-коды позиций склада и изделий (`qrcodes`); /q/:code — публичный редирект в приложение. */
@Module({
  imports: [MongooseModule.forFeature([{ name: QrCode.name, schema: QrCodeSchema }, { name: Material.name, schema: MaterialSchema }, { name: Product.name, schema: ProductSchema }])],
  controllers: [QrController, QrRedirectController],
  providers: [QrService],
  exports: [QrService],
})
export class QrModule {}
