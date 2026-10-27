import { Module } from '@nestjs/common';
import { FillAuditModule } from '../fill-audit/fill-audit.module';
import { FinanceModule } from '../finance/finance.module';
import { PartnersModule } from '../partners/partners.module';
import { SalesOrdersModule } from '../salesorders/salesorders.module';
import { StockModule } from '../stock/stock.module';
import { SupplyModule } from '../supply/supply.module';
import { TodayModule } from '../today/today.module';
import { AnthropicClient } from './anthropic.client';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AssistantStore } from './assistant.store';
import { AssistantTools } from './assistant.tools';

/** /api/assistant — помощник (ИИ-1, этап 1): чат с инструментами чтения. Свои коллекции: assistantchats, assistantusage. */
@Module({
  imports: [TodayModule, PartnersModule, StockModule, SupplyModule, SalesOrdersModule, FinanceModule, FillAuditModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantTools, AssistantStore, AnthropicClient],
})
export class AssistantModule {}
