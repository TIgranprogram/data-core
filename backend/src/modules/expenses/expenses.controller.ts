import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { MoneyAccessGuard } from '../../common/guards/money-access.guard';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';
import { ExpensesService } from './expenses.service';

/** Прочие расходы (только факт). Права — как у раздела «Деньги». */
@ApiTags('Прочие расходы')
@AppSection('money')
@UseGuards(MoneyAccessGuard)
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @Roles('admin', 'accountant', 'manager')
  list(@Query() q: Record<string, string>) { return this.expenses.list(q); }

  @Get(':id')
  @Roles('admin', 'accountant', 'manager')
  get(@Param('id') id: string) { return this.expenses.get(id); }

  @Post()
  @Roles('admin', 'accountant', 'manager')
  @AuditAction({ action: 'expense.created', entityType: 'Expense' })
  create(@Body() dto: CreateExpenseDto, @CurrentUser() user?: AuthenticatedUser) { return this.expenses.create(dto, user?.id); }

  @Patch(':id')
  @Roles('admin', 'accountant', 'manager')
  @AuditAction({ action: 'expense.updated', entityType: 'Expense', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto) { return this.expenses.update(id, dto); }

  @Delete(':id')
  @HttpCode(200)
  @Roles('admin', 'accountant', 'manager')
  @AuditAction({ action: 'expense.deleted', entityType: 'Expense', idParam: 'id' })
  remove(@Param('id') id: string) { return this.expenses.remove(id); }
}
