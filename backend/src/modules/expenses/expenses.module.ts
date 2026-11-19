import { ExpenseArticlesModule } from '../expense-articles/expense-articles.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Expense, ExpenseSchema } from './expense.schema';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

/** /api/expenses — «Прочие расходы» (факт): налоги, аренда, субподряд и всё, что не идёт заявкой снабжения. Читает finance. */
@Module({ imports: [ExpenseArticlesModule, MongooseModule.forFeature([{ name: Expense.name, schema: ExpenseSchema }])], controllers: [ExpensesController], providers: [ExpensesService], exports: [ExpensesService] })
export class ExpensesModule {}
