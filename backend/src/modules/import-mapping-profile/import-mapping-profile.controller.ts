import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreateImportMappingProfileDto,
  UpdateImportMappingProfileDto,
} from './dto/import-mapping-profile.dto';
import { ImportMappingProfileService } from './import-mapping-profile.service';

@ApiTags('Импорт — профили сопоставления')
@Controller('import-mapping-profiles')
export class ImportMappingProfileController {
  constructor(private readonly service: ImportMappingProfileService) {}

  @Get()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Список профилей сопоставления организации' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user);
  }

  @Post()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Сохранить профиль сопоставления' })
  create(@Body() dto: CreateImportMappingProfileDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Изменить профиль сопоставления' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateImportMappingProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Удалить профиль сопоставления' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.remove(id, user);
  }
}
