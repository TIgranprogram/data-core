import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { ZonesModule } from '../zones/zones.module';
import { StockModule } from '../stock/stock.module';
import { TodayController } from './today.controller';
import { TodayService } from './today.service';

/** /api/today — «Сегодня»: сборка из заявок, заказов, проектирования, склада и денег (своих таблиц нет). */
@Module({
  imports: [FinanceModule, StockModule, ZonesModule],
  controllers: [TodayController],
  providers: [TodayService],
})
export class TodayModule {}
