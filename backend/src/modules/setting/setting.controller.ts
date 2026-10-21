import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { SettingService } from './setting.service';
import { UpsertSettingDto } from './dto/upsert-setting.dto';
import { UpsertCatalogAppearanceDto } from './dto/upsert-catalog-appearance.dto';

@Controller('settings')
export class SettingController {
  constructor(private readonly service: SettingService) {}

  @Get()
  @Roles('admin', 'manager')
  findAll(@Query('group') group?: string) {
    return this.service.findAll(group);
  }

  @Get('catalog-appearance')
  @Roles('admin', 'manager', 'user')
  findCatalogAppearance(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findCatalogAppearance(user.organizationId);
  }

  @Put('catalog-appearance')
  @Roles('admin')
  upsertCatalogAppearance(
    @Body() dto: UpsertCatalogAppearanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setCatalogAppearance(dto.value, user.organizationId);
  }

  @Get(':key')
  @Roles('admin', 'manager')
  findOne(@Param('key') key: string) {
    return this.service.findByKey(key);
  }

  @Put(':key')
  @Roles('admin')
  upsert(@Param('key') key: string, @Body() dto: UpsertSettingDto) {
    return this.service.set(key, dto.value, dto.group, dto.description);
  }

  @Delete(':key')
  @Roles('admin')
  remove(@Param('key') key: string) {
    return this.service.remove(key);
  }
}
