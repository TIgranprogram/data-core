import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Quotation, QuotationSchema } from './quotation.schema';
import { QuotationService } from './quotation.service';
import { QuotationController } from './quotation.controller';
import { CounterModule } from '../counter/counter.module';
import { ContractModule } from '../contract/contract.module';
import { OrderModule } from '../order/order.module';
import { SiteModule } from '../site/site.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Quotation.name, schema: QuotationSchema }]),
    CounterModule,
    ContractModule,
    OrderModule,
    SiteModule,
  ],
  controllers: [QuotationController],
  providers: [QuotationService],
  exports: [QuotationService, MongooseModule],
})
export class QuotationModule {}
