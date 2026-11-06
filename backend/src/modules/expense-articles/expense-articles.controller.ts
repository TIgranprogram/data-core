import { Controller, Get } from '@nestjs/common';
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
