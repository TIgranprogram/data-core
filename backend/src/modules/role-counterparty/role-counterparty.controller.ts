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
import { RoleCounterpartyService, UpsertRoleCounterpartyDto } from './role-counterparty.service';

@Controller('counterparty-roles')
export class RoleCounterpartyController {
  constructor(private readonly service: RoleCounterpartyService) {}

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
  create(@Body() dto: UpsertRoleCounterpartyDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() dto: Partial<UpsertRoleCounterpartyDto>) {
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
