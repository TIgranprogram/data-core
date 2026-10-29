import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ZonesModule } from '../zones/zones.module';
import { IncomesController } from './incomes.controller';
import { IncomesService } from './incomes.service';
import { Income, IncomeSchema } from './income.schema';

/** /api/incomes — доходы (строки заказов); коллекция data-core `incomes`. */
@Module({
  imports: [MongooseModule.forFeature([{ name: Income.name, schema: IncomeSchema }]), ZonesModule],
  controllers: [IncomesController],
  providers: [IncomesService],
  exports: [IncomesService, MongooseModule],
})
export class IncomesModule {}
