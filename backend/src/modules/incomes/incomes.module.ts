import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductRequestsModule } from '../product-requests/product-requests.module';
import { ZonesModule } from '../zones/zones.module';
import { IncomesController } from './incomes.controller';
import { IncomeCancelService } from './income-cancel.service';
import { IncomesService } from './incomes.service';
import { Income, IncomeSchema } from './income.schema';

/** /api/incomes — доходы (строки заказов); коллекция data-core `incomes`. */
@Module({
  imports: [MongooseModule.forFeature([{ name: Income.name, schema: IncomeSchema }]), ZonesModule, ProductRequestsModule],
  controllers: [IncomesController],
  providers: [IncomesService, IncomeCancelService],
  exports: [IncomesService, IncomeCancelService, MongooseModule],
})
export class IncomesModule {}
