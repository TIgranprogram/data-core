import {
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupplierCatalogService } from './supplier-catalog.service';

@ApiTags('Каталог поставщиков')
@Controller('supplier-catalog')
export class SupplierCatalogController {
  constructor(private readonly service: SupplierCatalogService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'Список позиций поставщика' })
  @ApiQuery({ name: 'supplierId', required: true })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async list(
    @Query('supplierId') supplierId: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listItems({
      supplierId,
      q,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('sync/:orgId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Запустить синхронизацию каталога поставщика' })
  async startSync(@Param('orgId') orgId: string) {
    return this.service.startSync(orgId);
  }

  @Get('sync/:orgId')
  @Roles('admin', 'director', 'manager', 'user')
  @ApiOperation({ summary: 'Статус синхронизации каталога поставщика' })
  async getSyncStatus(@Param('orgId') orgId: string) {
    return this.service.getSyncStatus(orgId);
  }
}
