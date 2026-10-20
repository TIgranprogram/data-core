import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { MaterialDocument } from '../material/material.schema';
import { ProductModuleDocument } from '../product-module/product-module.schema';
import { ProductDocument } from '../product/product.schema';
import { CreateCompositionLineDto, UpdateCompositionLineDto } from './composition-line.dto';
import { CompositionLine, CompositionLineDocumentShape } from './composition-line.schema';

export const MAX_COMPOSITION_LINES = 1000;
type ParentKind = 'product' | 'module' | 'material';
type CompositionLineType = 'module' | 'material' | 'product';

export interface CompositionOwner {
  composition?: Array<CompositionLine | CompositionLineDocumentShape>;
}

export interface CompositionModels {
  materialModel: Model<MaterialDocument>;
  moduleModel?: Model<ProductModuleDocument>;
  productModel?: Model<ProductDocument>;
}

@Injectable()
export class CompositionLineService {
  toStoredLine(dto: CreateCompositionLineDto | UpdateCompositionLineDto, existing?: CompositionLineDocumentShape): CompositionLineDocumentShape {
    const lineType = dto.lineType ?? existing?.lineType;
    const refId = dto.refId ?? existing?.refId?.toString();
    if (!lineType || !refId || !Types.ObjectId.isValid(refId)) throw new BadRequestException('lineType and valid refId are required');
    this.assertLineType(lineType);
    return {
      _id: existing?._id ?? new Types.ObjectId(),
      lineType,
      refId: new Types.ObjectId(refId),
      quantity: dto.quantity ?? existing?.quantity ?? 1,
      sortOrder: dto.sortOrder ?? existing?.sortOrder ?? 0,
      unit: dto.unit ?? existing?.unit,
      overrideDimensions: dto.overrideDimensions ?? existing?.overrideDimensions,
      isPurchased: dto.isPurchased ?? existing?.isPurchased,
      sourcePosition: dto.sourcePosition ?? existing?.sourcePosition,
      sourceCode: dto.sourceCode ?? existing?.sourceCode,
      unitPriceOverride: dto.unitPriceOverride ?? existing?.unitPriceOverride,
      notes: dto.notes ?? existing?.notes,
    };
  }

  async validateReference(parentKind: ParentKind, line: CompositionLineDocumentShape, models: CompositionModels): Promise<void> {
    // unitPriceOverride guard: only for product lines
    if (line.unitPriceOverride !== undefined && line.lineType !== 'product') {
      throw new BadRequestException('unitPriceOverride is only allowed on product lines');
    }
    // Деталь (materialKind='part') composition is a flat BOM of raw materials
    // only — no nested modules/products/parts, so no cycle is structurally
    // possible (raw materials never carry their own composition).
    if (parentKind === 'material') {
      if (line.lineType !== 'material') {
        throw new BadRequestException('Деталь может содержать только материалы (сырьё)');
      }
      const material = await models.materialModel.findById(line.refId).select('materialKind').lean().exec();
      if (!material) throw new NotFoundException(`Material ${line.refId} not found`);
      if (material.materialKind !== 'raw') {
        throw new BadRequestException('В состав детали можно добавлять только сырьё');
      }
      return;
    }
    // Parent-kind guard: product lines only allowed on Product
    if (line.lineType === 'product' && parentKind === 'module') {
      throw new BadRequestException('Product lines may only be added to products, not modules');
    }
    if (line.lineType === 'product') {
      const product = await models.productModel?.findById(line.refId).select('_id').lean().exec();
      if (!product) throw new NotFoundException(`Product ${line.refId} not found`);
      // unitPriceOverride validation: only for product-lines, ≥0
      if (line.unitPriceOverride !== undefined && line.unitPriceOverride < 0) {
        throw new BadRequestException('unitPriceOverride must be ≥ 0');
      }
      return;
    }
    if (parentKind === 'product' && line.lineType === 'material') {
      const material = await models.materialModel.findById(line.refId).select('materialKind').lean().exec();
      if (!material) throw new NotFoundException(`Material ${line.refId} not found`);
      if (material.materialKind === 'raw') throw new BadRequestException('Raw materials may only be added to modules');
      return;
    }
    if (line.lineType === 'material') {
      const material = await models.materialModel.findById(line.refId).select('_id').lean().exec();
      if (!material) throw new NotFoundException(`Material ${line.refId} not found`);
      return;
    }
    const module = await models.moduleModel?.findById(line.refId).select('_id').lean().exec();
    if (!module) throw new NotFoundException(`ProductModule ${line.refId} not found`);
  }

  ensureLineLimit(lines: CompositionLineDocumentShape[]): void {
    if (lines.length > MAX_COMPOSITION_LINES) throw new BadRequestException(`Composition cannot contain more than ${MAX_COMPOSITION_LINES} lines`);
  }

  ensureNoDuplicateKeys(lines: CompositionLineDocumentShape[]): void {
    const seen = new Set<string>();
    for (const line of lines) {
      const key = `${line.lineType}:${line.refId.toString()}`;
      if (seen.has(key)) throw new BadRequestException('Duplicate composition line');
      seen.add(key);
    }
  }

  upsertDeduplicated(current: CompositionLineDocumentShape[], incoming: CompositionLineDocumentShape): CompositionLineDocumentShape[] {
    const index = current.findIndex((line) => line.lineType === incoming.lineType && line.refId.toString() === incoming.refId.toString());
    if (index < 0) return [...current, incoming];
    const next = current.slice();
    const existing = next[index];
    next[index] = {
      _id: existing._id,
      lineType: existing.lineType,
      refId: existing.refId,
      quantity: existing.quantity + incoming.quantity,
      sortOrder: existing.sortOrder,
      unit: existing.unit,
      overrideDimensions: existing.overrideDimensions,
      isPurchased: existing.isPurchased,
      sourcePosition: existing.sourcePosition,
      sourceCode: existing.sourceCode,
      unitPriceOverride: existing.unitPriceOverride,
      notes: existing.notes,
    };
    return next;
  }

  dualRead(owner: CompositionOwner, legacy: CompositionLineDocumentShape[]): CompositionLineDocumentShape[] {
    return owner.composition?.length ? (owner.composition as CompositionLineDocumentShape[]) : legacy;
  }

  assertLineType(type: string): asserts type is CompositionLineType {
    if (type !== 'module' && type !== 'material' && type !== 'product') throw new BadRequestException(`Unsupported composition lineType: ${type}`);
  }
}
