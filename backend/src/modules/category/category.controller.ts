import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('Справочники — Категории')
@Controller('categories')
export class CategoryController {
  constructor(private readonly service: CategoryService) {}

  @Get()
  @Roles('admin', 'director', 'manager')
  list(@CurrentUser() user: AuthenticatedUser, @Query('type') type?: string) { return this.service.findAll(type, user.organizationId); }

  @Get('tree')
  @Roles('admin', 'director', 'manager')
  tree(@CurrentUser() user: AuthenticatedUser, @Query('type') type?: string) { return this.service.buildTree(type, user.organizationId); }

  @Get(':id')
  @Roles('admin', 'director', 'manager')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) { return this.service.findById(id, user.organizationId); }

  @Post()
  @Roles('admin')
  @AuditAction({ action: 'create', entityType: 'Category' })
  create(@Body() dto: CreateCategoryDto, @CurrentUser() user: AuthenticatedUser) { return this.service.create(dto, user.organizationId); }

  @Post('reorder')
  @Roles('admin')
  @AuditAction({ action: 'reorder', entityType: 'Category' })
  reorder(@Body('categoryIds') categoryIds: string[], @CurrentUser() user: AuthenticatedUser) { return this.service.reorder(categoryIds, user.organizationId); }

  @Post('reorder-children')
  @Roles('admin')
  @AuditAction({ action: 'reorder', entityType: 'Category' })
  reorderChildren(@Body('parentId') parentId: string | null, @Body('childIds') childIds: string[], @CurrentUser() user: AuthenticatedUser) { return this.service.reorderChildren(parentId, childIds, user.organizationId); }

  @Patch(':id')
  @Roles('admin')
  @AuditAction({ action: 'update', entityType: 'Category', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto, @CurrentUser() user: AuthenticatedUser) { return this.service.update(id, dto, user.organizationId); }

  @Delete(':id')
  @Roles('admin')
  @AuditAction({ action: 'delete', entityType: 'Category', idParam: 'id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) { return this.service.remove(id, user.organizationId); }
}
