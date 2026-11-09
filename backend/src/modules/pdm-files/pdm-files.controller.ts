import { Controller, Get, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PdmFilesService } from './pdm-files.service';

/** Файлы из PDM (чертежи, развёртки). Читают те же роли, что изделия; записывает только сервис импорта. */
@ApiTags('Файлы PDM')
@AppSection('products')
@Controller('pdm-files')
export class PdmFilesController {
  constructor(private readonly service: PdmFilesService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  @ApiQuery({ name: 'ownerKind', required: true, enum: ['product', 'module', 'material'] })
  @ApiQuery({ name: 'ownerId', required: true })
  list(@Query('ownerKind') ownerKind: string, @Query('ownerId') ownerId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.list(ownerKind, ownerId, user.organizationId);
  }
}
