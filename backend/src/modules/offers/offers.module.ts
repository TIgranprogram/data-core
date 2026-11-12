import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { CounterModule } from '../counter/counter.module';
import { IncomesModule } from '../incomes/incomes.module';
import { SalesOrdersModule } from '../salesorders/salesorders.module';
import { ShowcaseModule } from '../showcase/showcase.controller';
import { OfferBackgroundsService } from './offer-backgrounds.service';
import { OfferIntakeService } from './offer-intake.service';
import { CommercialOffer, CommercialOfferSchema, OfferBackground, OfferBackgroundSchema } from './offer.schema';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

/** /api/offers — коммерческие предложения (`commercialoffers`) и их фоны PDF (`offerbackgrounds`). */
@Module({
  imports: [MongooseModule.forFeature([{ name: CommercialOffer.name, schema: CommercialOfferSchema }, { name: OfferBackground.name, schema: OfferBackgroundSchema }]), CounterModule, SalesOrdersModule, IncomesModule, AuditModule, ShowcaseModule],
  controllers: [OffersController],
  providers: [OffersService, OfferBackgroundsService, OfferIntakeService],
})
export class OffersModule {}
