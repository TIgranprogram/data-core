import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { FormProfilesService } from './form-profiles.service';
import { UpsertFormProfileDto } from './dto/upsert-form-profile.dto';

/**
 * TZ-DICT-314 — QuickCreate form profiles (S/M/L) API.
 * Settings UI → DICT-315; dialog wire → DICT-316.
 */
@ApiTags('Справочники — Профили быстрых форм')
@Controller('form-profiles')
export class FormProfilesController {
  constructor(private readonly service: FormProfilesService) {}

  @Get()
  @Roles('admin', 'manager', 'user')
  @ApiOperation({ summary: 'List form profiles for current organization' })
  @ApiQuery({
    name: 'entity',
    required: false,
    description: 'Filter: product | module',
  })
  @ApiResponse({ status: 200, description: 'Profiles (seeded on first GET)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('entity') entity?: string,
  ) {
    // System admin may have null organizationId — service resolves default org.
    return this.service.list(user.organizationId, entity);
  }

  @Get(':entity/:size')
  @Roles('admin', 'manager', 'user')
  @ApiOperation({ summary: 'Get one form profile (entity × size)' })
  @ApiResponse({ status: 200, description: 'Profile found or seeded' })
  @ApiResponse({ status: 400, description: 'Invalid entity/size or missing org' })
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entity') entity: string,
    @Param('size') size: string,
  ) {
    return this.service.getOne(user.organizationId, entity, size);
  }

  @Put(':entity/:size')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'FormProfile' })
  @ApiOperation({ summary: 'Replace visible FieldKeys for entity × size' })
  @ApiResponse({ status: 200, description: 'Profile upserted' })
  @ApiResponse({
    status: 400,
    description: 'LockedRequired stripped or unknown FieldKey',
  })
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entity') entity: string,
    @Param('size') size: string,
    @Body() dto: UpsertFormProfileDto,
  ) {
    return this.service.upsert(
      user.organizationId,
      entity,
      size,
      dto.visibleFieldKeys,
    );
  }
}
