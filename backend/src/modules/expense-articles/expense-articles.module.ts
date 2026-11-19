import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Counter, CounterSchema } from '../counter/counter.schema';
import { AuditLog, AuditLogSchema } from '../audit/audit-log.schema';
import { ExpenseArticlesController, FinancialArticlesController } from './expense-articles.controller';
import { ExpenseArticlesService } from './expense-articles.service';
import { FinancialArticle, FinancialArticleSchema } from './financial-article.schema';
import { FinancialArticleWriter } from './financial-article-writer';
@Module({ imports: [MongooseModule.forFeature([{ name: FinancialArticle.name, schema: FinancialArticleSchema }, { name: Counter.name, schema: CounterSchema }, { name: AuditLog.name, schema: AuditLogSchema }])],
  controllers: [ExpenseArticlesController, FinancialArticlesController], providers: [ExpenseArticlesService, FinancialArticleWriter], exports: [ExpenseArticlesService] })
export class ExpenseArticlesModule {}
