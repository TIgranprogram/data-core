import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AttributeDefinition, AttributeDefinitionDocument } from '../../modules/attribute-definition/attribute-definition.schema';
import { EntityAttributeValue, EntityAttributeValueDocument } from '../../modules/entity-attribute-value/entity-attribute-value.schema';

/**
 * EAV (Entity-Attribute-Value) runtime helper.
 *
 * - Loads all AttributeDefinition for (entityType, categoryId?)
 * - Validates raw values against attribute type (string/number/date/enum/boolean)
 * - Upserts EntityAttributeValue documents
 * - Returns flat map { attributeName: parsedValue }
 */
@Injectable()
export class EavService {
  private readonly logger = new Logger(EavService.name);

  constructor(
    @InjectModel(AttributeDefinition.name)
    private readonly defModel: Model<AttributeDefinitionDocument>,
    @InjectModel(EntityAttributeValue.name)
    private readonly valueModel: Model<EntityAttributeValueDocument>,
  ) {}

  /**
   * Resolve and persist attributes for an entity.
   * - Throws BadRequestException on type/required violation.
   * - Skips unknown attribute names (returns warning log only).
   * - Returns parsed values keyed by attribute name.
   */
  async resolveAttributes(
    entityType: string,
    entityId: Types.ObjectId,
    raw: Record<string, unknown>,
    categoryId?: Types.ObjectId,
  ): Promise<Record<string, unknown>> {
    if (!raw || Object.keys(raw).length === 0) return {};

    const defFilter: Record<string, unknown> = {
      entityType,
      isActive: true,
    };
    if (categoryId) {
      defFilter.$or = [{ categoryId }, { categoryId: null }, { categoryId: undefined }];
    }
    const defs = await this.defModel.find(defFilter).exec();
    const defsByName = new Map(defs.map((d) => [d.name, d]));

    const result: Record<string, unknown> = {};
    const operations: any[] = [];
    for (const [name, value] of Object.entries(raw)) {
      const def = defsByName.get(name);
      if (!def) {
        this.logger.warn(`Unknown attribute "${name}" for ${entityType} ${entityId}`);
        continue;
      }
      const parsed = this.validateAndParse(name, value, def);
      result[name] = parsed;
      operations.push({
        updateOne: {
          filter: { entityType, entityId, attributeId: def._id },
          update: { $set: { value: parsed } },
          upsert: true,
        },
      });
    }
    if (operations.length > 0) {
      const session = await this.valueModel.db.startSession();
      try {
        await session.withTransaction(async () => {
          await this.valueModel.bulkWrite(operations, { session, ordered: true });
        });
      } catch (err) {
        this.logger.error(
          `EAV bulkWrite failed for ${entityType} ${entityId}: ${(err as Error).message}`,
          (err as Error).stack,
        );
        throw err;
      } finally {
        await session.endSession();
      }
    }
    return result;
  }

  /**
   * Load all attribute values for entity as { name: value }.
   */
  async loadAttributes(
    entityType: string,
    entityId: Types.ObjectId,
  ): Promise<Record<string, unknown>> {
    const values = await this.valueModel
      .find({ entityType, entityId })
      .populate('attributeId')
      .exec();

    const out: Record<string, unknown> = {};
    for (const v of values) {
      const def = v.attributeId as unknown as { name?: string };
      if (def?.name) out[def.name] = v.value;
    }
    return out;
  }

  /**
   * Set single attribute (PUT /.../attributes/:attributeId).
   */
  async setValue(
    entityType: string,
    entityId: Types.ObjectId,
    attributeId: Types.ObjectId,
    value: unknown,
  ): Promise<void> {
    const def = await this.defModel.findById(attributeId).exec();
    if (!def) throw new BadRequestException(`AttributeDefinition ${attributeId} not found`);
    const parsed = this.validateAndParse(def.name, value, def);
    await this.valueModel.updateOne(
      { entityType, entityId, attributeId: def._id },
      { $set: { value: parsed } },
      { upsert: true },
    ).exec();
  }

  async deleteValue(
    entityType: string,
    entityId: Types.ObjectId,
    attributeId: Types.ObjectId,
  ): Promise<void> {
    await this.valueModel
      .deleteOne({ entityType, entityId, attributeId })
      .exec();
  }

  /**
   * Validate and coerce value per AttributeDefinition.type.
   */
  private validateAndParse(name: string, value: unknown, def: AttributeDefinitionDocument): unknown {
    if (value === null || value === undefined || value === '') {
      if (def.required) {
        throw new BadRequestException(`Attribute "${name}" is required`);
      }
      return null;
    }
    switch (def.type) {
      case 'string': {
        const s = String(value);
        return s;
      }
      case 'number': {
        const n = Number(value);
        if (Number.isNaN(n)) {
          throw new BadRequestException(`Attribute "${name}" must be a number`);
        }
        return n;
      }
      case 'boolean': {
        if (typeof value === 'boolean') return value;
        if (value === 'true' || value === 1 || value === '1') return true;
        if (value === 'false' || value === 0 || value === '0') return false;
        throw new BadRequestException(`Attribute "${name}" must be boolean`);
      }
      case 'date': {
        const d = value instanceof Date ? value : new Date(String(value));
        if (Number.isNaN(d.getTime())) {
          throw new BadRequestException(`Attribute "${name}" must be a valid date`);
        }
        return d;
      }
      case 'enum': {
        const s = String(value).trim();
        if (!def.options || !def.options.includes(s)) {
          throw new BadRequestException(
            `Attribute "${name}" must be one of: ${def.options?.join(', ')}`,
          );
        }
        return s;
      }
      default:
        return value;
    }
  }
}
