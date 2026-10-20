import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EntityAttributeValue, EntityAttributeValueDocument } from './entity-attribute-value.schema';
import { EavService } from '../../common/eav/eav.service';

@Injectable()
export class EntityAttributeValueService {
  constructor(
    @InjectModel(EntityAttributeValue.name)
    private readonly model: Model<EntityAttributeValueDocument>,
    private readonly eavService: EavService,
  ) {}

  async loadFor(entityType: string, entityId: Types.ObjectId): Promise<Record<string, unknown>> {
    return this.eavService.loadAttributes(entityType, entityId);
  }

  async resolveAndStore(
    entityType: string,
    entityId: Types.ObjectId,
    raw: Record<string, unknown>,
    categoryId?: Types.ObjectId,
  ): Promise<Record<string, unknown>> {
    return this.eavService.resolveAttributes(entityType, entityId, raw, categoryId);
  }
}
