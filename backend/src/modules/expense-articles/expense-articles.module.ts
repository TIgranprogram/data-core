import { Module } from '@nestjs/common';
import { ExpenseArticlesController } from './expense-articles.controller';
import { ExpenseArticlesService } from './expense-articles.service';

/** /api/expense-articles — дерево статей расходов; стартовый набор при первом запуске. */
@Module({ controllers: [ExpenseArticlesController], providers: [ExpenseArticlesService], exports: [ExpenseArticlesService] })
export class ExpenseArticlesModule {}
