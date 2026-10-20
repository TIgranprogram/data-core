import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { UnitService } from './unit.service';

@Controller('units')
export class UnitController {
  constructor(private readonly service: UnitService) {}

  @Get()
  @Roles('admin', 'director', 'manager', 'user')
  list(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.service.findAll({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      search,
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  /** Compact active-only list for form dropdowns (no pagination). */
  @Get('active')
  @Roles('admin', 'director', 'manager', 'user')
  listActive() {
    return this.service.findActive();
  }

  @Get(':key')
  @Roles('admin', 'director', 'manager', 'user')
  findOne(@Param('key') key: string) {
    return this.service.findByKey(key);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Unit' })
  create(@Body() dto: CreateUnitDto) {
    return this.service.create(dto);
  }

  @Patch(':key')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'Unit', idParam: 'key' })
  update(@Param('key') key: string, @Body() dto: UpdateUnitDto) {
    return this.service.update(key, dto);
  }

  @Delete(':key')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Unit', idParam: 'key' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('key') key: string) {
    return this.service.remove(key);
  }
}
