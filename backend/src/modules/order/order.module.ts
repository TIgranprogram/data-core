import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from './order.schema';
import { OrderService } from './order.service';
import { KitReserveService } from './kit-reserve.service';
import { OrderController } from './order.controller';
import { CounterModule } from '../counter/counter.module';
import { ReservationModule } from '../reservation/reservation.module';
import { ShipmentModule } from '../shipment/shipment.module';
import { SessionRunner } from '../../common/db/session-runner';
import { SiteModule } from '../site/site.module';
import { Quotation, QuotationSchema } from '../quotation/quotation.schema';
import { OrganizationModule } from '../organization/organization.module';
import { Product, ProductSchema } from '../product/product.schema';
import { ProductModule, ProductModuleSchema } from '../product-module/product-module.schema';
import { WorkType, WorkTypeSchema } from '../work-type/work-type.schema';
import { Material, MaterialSchema } from '../material/material.schema';
import { StorageItemModule } from '../storage-item/storage-item.module';
import { SupplyRequestModule } from '../supply/supply-request.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Order.name, schema: OrderSchema }]),
    // TZ-ORDERS-306: модель КП регистрируется здесь, а не через QuotationModule —
    // QuotationModule сам импортирует OrderModule (convert-to-order), и импорт
    // обратно дал бы циклическую зависимость модулей.
    MongooseModule.forFeature([{ name: Quotation.name, schema: QuotationSchema }]),
    // TZ-COMBINE-408: gate входа линии/модуля в shop — нужны Product → modules → WorkType.days.
    MongooseModule.forFeature([{ name: Product.name, schema: ProductSchema }]),
    MongooseModule.forFeature([{ name: ProductModule.name, schema: ProductModuleSchema }]),
    MongooseModule.forFeature([{ name: WorkType.name, schema: WorkTypeSchema }]),
    // TZ-NX-SUPPLY-S0: kit-reserve walks composition → Material catalog + warehouse stock.
    MongooseModule.forFeature([{ name: Material.name, schema: MaterialSchema }]),
    CounterModule,
    ReservationModule,
    ShipmentModule,
    SiteModule,
    OrganizationModule,
    StorageItemModule,
    SupplyRequestModule,
  ],
  controllers: [OrderController],
  providers: [OrderService, SessionRunner, KitReserveService],
  exports: [OrderService, MongooseModule],
})
export class OrderModule {}
