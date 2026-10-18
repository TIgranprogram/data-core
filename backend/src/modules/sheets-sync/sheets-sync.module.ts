import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { SheetsSyncController } from './sheets-sync.controller';
import { SheetsSyncService } from './sheets-sync.service';

/** Чтение Google-таблиц сервером (сервисный аккаунт) → общие коллекции CRM (заявки, номенклатура и остатки, движения); «Реестр счетов» — /api/apps/supply/invoices. */
@Module({
  imports: [StockModule],
  controllers: [SheetsSyncController],
  providers: [SheetsSyncService],
})
export class SheetsSyncModule {}
