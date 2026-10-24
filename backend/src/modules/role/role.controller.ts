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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RoleService } from './role.service';
import { APP_SECTIONS } from '../../common/app-sections';

@ApiTags('Управление — Роли')
@Controller('roles')
export class RoleController {
  constructor(private readonly service: RoleService) {}

  @Get()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'List all roles' })
  @ApiResponse({ status: 200, description: 'List of roles' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll() {
    return this.service.findAll();
  }

  /** SK-8a: список разделов «Рабочего места» для галочек у роли. */
  @Get('app-sections')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Разделы «Рабочего места», которые можно включить роли' })
  @ApiResponse({ status: 200, description: '{ items: [{ id, label }] }' })
  appSections() {
    return { items: APP_SECTIONS.map((s) => ({ ...s })) };
  }

  @Get(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Get role by ID' })
  @ApiResponse({ status: 200, description: 'Role found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Новая своя роль (SK-8c): название, «права как у» (baseRole), разделы; код r-… задаёт сервер' })
  @ApiResponse({ status: 201, description: 'Role created' })
  @ApiResponse({ status: 400, description: 'Нет baseRole или передан name' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  create(@Body() dto: CreateRoleDto) {
    return this.service.createCustom(dto);
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update an existing role (admin only)' })
  @ApiResponse({ status: 200, description: 'Role updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 400, description: 'Код роли или «права как у» встроенной роли менять нельзя' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a role (admin only)' })
  @ApiResponse({ status: 204, description: 'Role deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({ status: 409, description: 'Встроенная роль или роль назначена сотрудникам' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
