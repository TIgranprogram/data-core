import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CounterModule } from '../counter/counter.module';
import { OfferBackgroundsService } from './offer-backgrounds.service';
import { CommercialOffer, CommercialOfferSchema, OfferBackground, OfferBackgroundSchema } from './offer.schema';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

/** /api/offers — коммерческие предложения (`commercialoffers`) и их фоны PDF (`offerbackgrounds`). */
@Module({
  imports: [MongooseModule.forFeature([{ name: CommercialOffer.name, schema: CommercialOfferSchema }, { name: OfferBackground.name, schema: OfferBackgroundSchema }]), CounterModule],
  controllers: [OffersController],
  providers: [OffersService, OfferBackgroundsService],
})
export class OffersModule {}
