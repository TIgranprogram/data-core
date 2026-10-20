import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { RoleOrgService, UpsertRoleOrgDto } from './role-org.service';

@Controller('org-roles')
export class RoleOrgController {
  constructor(private readonly service: RoleOrgService) {}

  @Get()
  @Roles('admin', 'manager')
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @Roles('admin', 'manager')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin')
  create(@Body() dto: UpsertRoleOrgDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() dto: Partial<UpsertRoleOrgDto>) {
    return this.service.findById(id).then(async (doc) => {
      Object.assign(doc, dto);
      return doc.save();
    });
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
