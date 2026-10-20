import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IncomesController } from './incomes.controller';
import { IncomesService } from './incomes.service';
import { Income, IncomeSchema } from './income.schema';

/** /api/incomes — доходы (строки заказов); коллекция data-core `incomes`. */
@Module({
  imports: [MongooseModule.forFeature([{ name: Income.name, schema: IncomeSchema }])],
  controllers: [IncomesController],
  providers: [IncomesService],
  exports: [IncomesService, MongooseModule],
})
export class IncomesModule {}
