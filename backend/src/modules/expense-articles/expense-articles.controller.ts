import { FinancialArticleQueryDto } from './financial-article.dto';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { ExpenseArticlesService } from './expense-articles.service';

/** Статьи расходов (дерево для выбора в формах). Правка — «Справочники → Статьи расходов». */
@ApiTags('Статьи расходов')
@Controller('expense-articles')
export class ExpenseArticlesController {
  constructor(private readonly articles: ExpenseArticlesService) {}

  @Get()
  @Roles('user')
  list() { return this.articles.list(); }
}

/** Каноническое дерево доходов/расходов; прежний маршрут остаётся расходной проекцией. */
@ApiTags('Финансовые статьи')
@Controller('financial-articles')
export class FinancialArticlesController {
  constructor(private readonly articles: ExpenseArticlesService) {}
  @Get() @Roles('user')
  list(@Query() query: FinancialArticleQueryDto) { return this.articles.financialList({ type: query.type, includeArchived: query.includeArchived === '1', includeUsage: query.includeUsage === '1' }); }
}
