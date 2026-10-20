import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UpdateDictionaryLabelDto } from './dto/update-dictionary-label.dto';
import { DictionaryLabelScope } from './dictionary-label.schema';
import { DictionaryLabelService } from './dictionary-label.service';

@ApiTags('Справочники — Подписи')
@Controller('dictionary-labels')
export class DictionaryLabelController {
  constructor(private readonly service: DictionaryLabelService) {}

  @Get()
  @Roles('user', 'admin', 'director', 'manager')
  @ApiOperation({ summary: 'Получить подписи справочников' })
  @ApiQuery({ name: 'scope', required: false, enum: ['productKind', 'materialKind'] })
  list(
    @Query('scope') scope: DictionaryLabelScope | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(scope, user.organizationId);
  }

  @Get('active')
  @Roles('user', 'admin', 'director', 'manager')
  @ApiOperation({ summary: 'Получить активные подписи для селектов' })
  @ApiQuery({ name: 'scope', required: false, enum: ['productKind', 'materialKind'] })
  active(
    @Query('scope') scope: DictionaryLabelScope | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.active(scope, user.organizationId);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Изменить подпись справочника' })
  patch(
    @Param('id') id: string,
    @Body() dto: UpdateDictionaryLabelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user.organizationId);
  }
}
