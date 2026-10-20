import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AttributeDefinition,
  AttributeDefinitionDocument,
} from './attribute-definition.schema';
import { CreateAttributeDefinitionDto } from './dto/create-attribute-definition.dto';
import { UpdateAttributeDefinitionDto } from './dto/update-attribute-definition.dto';

@Injectable()
export class AttributeDefinitionService {
  constructor(
    @InjectModel(AttributeDefinition.name)
    private readonly model: Model<AttributeDefinitionDocument>,
  ) {}

  async create(dto: CreateAttributeDefinitionDto): Promise<AttributeDefinitionDocument> {
    return this.model.create({
      ...dto,
      categoryId: dto.categoryId ? new Types.ObjectId(dto.categoryId) : undefined,
      options: dto.type === 'enum' ? (dto.options ?? []) : undefined,
    });
  }

  async findAll(entityType?: string, categoryId?: string): Promise<AttributeDefinitionDocument[]> {
    const filter: Record<string, unknown> = { isActive: true };
    if (entityType) filter.entityType = entityType;
    if (categoryId) {
      filter.$or = [
        { categoryId: new Types.ObjectId(categoryId) },
        { categoryId: null },
        { categoryId: undefined },
      ];
    }
    return this.model.find(filter).sort({ sortOrder: 1, name: 1 }).exec();
  }

  async findById(id: string): Promise<AttributeDefinitionDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`AttributeDefinition ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`AttributeDefinition ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateAttributeDefinitionDto): Promise<AttributeDefinitionDocument> {
    const doc = await this.findById(id);
    if (dto.categoryId !== undefined) {
      doc.categoryId = dto.categoryId ? new Types.ObjectId(dto.categoryId) : (undefined as unknown as Types.ObjectId);
    }
    if (dto.label !== undefined) doc.label = dto.label;
    if (dto.type !== undefined) doc.type = dto.type;
    if (dto.unit !== undefined) doc.unit = dto.unit;
    if (dto.options !== undefined) doc.options = dto.options;
    if (dto.required !== undefined) doc.required = dto.required;
    if (dto.sortOrder !== undefined) doc.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    if (dto.description !== undefined) doc.description = dto.description;
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date(), isActive: false } })
      .exec();
  }
}
