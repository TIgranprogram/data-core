import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AttributeDefinitionService } from './attribute-definition.service';
import { CreateAttributeDefinitionDto } from './dto/create-attribute-definition.dto';
import { UpdateAttributeDefinitionDto } from './dto/update-attribute-definition.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller('attribute-definitions')
export class AttributeDefinitionController {
  constructor(private readonly service: AttributeDefinitionService) {}

  @Get()
  findAll(@Query('entityType') entityType?: string, @Query('categoryId') categoryId?: string) {
    return this.service.findAll(entityType, categoryId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'AttributeDefinition' })
  create(@Body() dto: CreateAttributeDefinitionDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'AttributeDefinition' })
  update(@Param('id') id: string, @Body() dto: UpdateAttributeDefinitionDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'AttributeDefinition' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
