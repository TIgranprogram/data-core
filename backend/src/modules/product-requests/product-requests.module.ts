import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ShowcaseModule } from '../showcase/showcase.controller';
import { ZonesModule } from '../zones/zones.module';
import { ProductRequestsController } from './product-requests.controller';
import { ProductRequestsService } from './product-requests.service';
import { ProductRequest, ProductRequestSchema } from './product-request.schema';

/** /api/product-requests — заявки на создание нового изделия; коллекция data-core `productrequests`. */
@Module({
  imports: [MongooseModule.forFeature([{ name: ProductRequest.name, schema: ProductRequestSchema }]), ShowcaseModule, ZonesModule],
  controllers: [ProductRequestsController],
  providers: [ProductRequestsService],
  exports: [ProductRequestsService],
})
export class ProductRequestsModule {}
