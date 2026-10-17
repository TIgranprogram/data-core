import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Tender, TenderSchema } from './tender.schema';
import { TenderService } from './tender.service';
import { TenderController } from './tender.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Tender.name, schema: TenderSchema }]),
  ],
  controllers: [TenderController],
  providers: [TenderService],
  exports: [TenderService, MongooseModule],
})
export class TenderModule {}
