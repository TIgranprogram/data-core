import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Currency, CurrencySchema } from './currency.schema';
import { CurrencyService } from './currency.service';
import { CurrencyController } from './currency.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Currency.name, schema: CurrencySchema }]),
  ],
  controllers: [CurrencyController],
  providers: [CurrencyService],
  exports: [CurrencyService, MongooseModule],
})
export class CurrencyModule {}
