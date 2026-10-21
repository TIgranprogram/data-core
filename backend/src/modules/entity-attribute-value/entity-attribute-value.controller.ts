import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
} from '@nestjs/common';
import { EntityAttributeValueService } from './entity-attribute-value.service';
import { EavService } from '../../common/eav/eav.service';
import { SetAttributeValueDto } from './dto/set-attribute-value.dto';
import { BulkAttributesDto } from './dto/bulk-attributes.dto';
import { Types } from 'mongoose';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { BadRequestException } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Generic per-entity EAV endpoint: GET/PUT/POST/DELETE under
 *   /<entityType>/:entityId/attributes[/:attributeId]
 *
 * Allowed entityTypes whitelisted to prevent abuse.
 */
const ALLOWED_ENTITY_TYPES = new Set([
  'Product',
  'Material',
  'Organization',
  'Counterparty',
  'Person',
]);

@Controller()
export class EntityAttributeValueController {
  constructor(
    private readonly service: EntityAttributeValueService,
    private readonly eavService: EavService,
  ) {}

  private ensureEntityType(entityType: string): void {
    if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
      throw new BadRequestException(`Entity type "${entityType}" not allowed for EAV`);
    }
  }

  @Get(':entityType/:entityId/attributes')
  async getAttributes(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    this.ensureEntityType(entityType);
    if (!Types.ObjectId.isValid(entityId)) {
      throw new BadRequestException('Invalid entityId');
    }
    return this.service.loadFor(entityType, new Types.ObjectId(entityId));
  }

  @Put(':entityType/:entityId/attributes')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'set_attribute', entityType: 'EntityAttributeValue' })
  async bulkSet(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Body() dto: BulkAttributesDto,
  ) {
    this.ensureEntityType(entityType);
    if (!Types.ObjectId.isValid(entityId)) {
      throw new BadRequestException('Invalid entityId');
    }
    return this.service.resolveAndStore(
      entityType,
      new Types.ObjectId(entityId),
      dto.attributes ?? {},
    );
  }

  @Put(':entityType/:entityId/attributes/:attributeId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'set_attribute', entityType: 'EntityAttributeValue' })
  async setOne(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Param('attributeId') attributeId: string,
    @Body() dto: SetAttributeValueDto,
  ) {
    this.ensureEntityType(entityType);
    if (!Types.ObjectId.isValid(entityId) || !Types.ObjectId.isValid(attributeId)) {
      throw new BadRequestException('Invalid id');
    }
    await this.eavService.setValue(
      entityType,
      new Types.ObjectId(entityId),
      new Types.ObjectId(attributeId),
      dto.value,
    );
    return { ok: true };
  }

  @Delete(':entityType/:entityId/attributes/:attributeId')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete_attribute', entityType: 'EntityAttributeValue' })
  async remove(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Param('attributeId') attributeId: string,
  ) {
    this.ensureEntityType(entityType);
    if (!Types.ObjectId.isValid(entityId) || !Types.ObjectId.isValid(attributeId)) {
      throw new BadRequestException('Invalid id');
    }
    await this.eavService.deleteValue(
      entityType,
      new Types.ObjectId(entityId),
      new Types.ObjectId(attributeId),
    );
    return { ok: true };
  }
}
