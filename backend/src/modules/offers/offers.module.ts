import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { CounterModule } from '../counter/counter.module';
import { IncomesModule } from '../incomes/incomes.module';
import { SalesOrdersModule } from '../salesorders/salesorders.module';
import { OfferBackgroundsService } from './offer-backgrounds.service';
import { CommercialOffer, CommercialOfferSchema, OfferBackground, OfferBackgroundSchema } from './offer.schema';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

/** /api/offers — коммерческие предложения (`commercialoffers`) и их фоны PDF (`offerbackgrounds`). */
@Module({
  imports: [MongooseModule.forFeature([{ name: CommercialOffer.name, schema: CommercialOfferSchema }, { name: OfferBackground.name, schema: OfferBackgroundSchema }]), CounterModule, SalesOrdersModule, IncomesModule, AuditModule],
  controllers: [OffersController],
  providers: [OffersService, OfferBackgroundsService],
})
export class OffersModule {}
