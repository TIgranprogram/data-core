import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { MaterialDocument } from '../../modules/material/material.schema';
import { ProductModuleDocument } from './product-module.schema';
import { ProductDocument } from './product.schema';
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

export interface LegacyModuleMaterial {
  materialId?: unknown;
  quantity?: number;
  unit?: string;
  isPurchased?: boolean;
  overrideDimensions?: CompositionLineDocumentShape['overrideDimensions'];
  sortOrder?: number;
}

/** ObjectId, строка или populated `{_id}` — без `[object Object]`. */
export function legacyRefId(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && '_id' in value) {
    const nested = (value as { _id?: unknown })._id;
    if (nested != null && nested !== value) return legacyRefId(nested);
  }
  if (typeof value === 'object' && value !== null && typeof (value as { toHexString?: unknown }).toHexString === 'function') {
    return (value as { toHexString: () => string }).toHexString();
  }
  const text = String(value);
  return text === '[object Object]' ? '' : text;
}

function copyOverrideDimensions(
  value: LegacyModuleMaterial['overrideDimensions'],
): CompositionLineDocumentShape['overrideDimensions'] | undefined {
  if (!value) return undefined;
  const src = typeof (value as { toObject?: () => LegacyModuleMaterial['overrideDimensions'] }).toObject === 'function'
    ? (value as { toObject: () => LegacyModuleMaterial['overrideDimensions'] }).toObject()
    : value;
  if (!src) return undefined;
  const out: NonNullable<CompositionLineDocumentShape['overrideDimensions']> = {};
  if (src.length !== undefined) out.length = src.length;
  if (src.width !== undefined) out.width = src.width;
  if (src.height !== undefined) out.height = src.height;
  if (src.unit !== undefined) out.unit = src.unit;
  return Object.keys(out).length ? out : undefined;
}

/** Чтение графа: legacy materials[] без нового `_id` на каждый вызов. */
export function previewModuleMaterialLines(materials: LegacyModuleMaterial[] | undefined): Array<Omit<CompositionLineDocumentShape, '_id'>> {
  const lines: Array<Omit<CompositionLineDocumentShape, '_id'>> = [];
  for (const row of materials ?? []) {
    const materialId = legacyRefId(row.materialId);
    if (!Types.ObjectId.isValid(materialId)) continue;
    const overrideDimensions = copyOverrideDimensions(row.overrideDimensions);
    lines.push({
      lineType: 'material',
      refId: new Types.ObjectId(materialId),
      quantity: row.quantity ?? 1,
      sortOrder: row.sortOrder ?? 0,
      ...(row.unit !== undefined ? { unit: row.unit } : {}),
      ...(overrideDimensions ? { overrideDimensions } : {}),
      ...(row.isPurchased !== undefined ? { isPurchased: row.isPurchased } : {}),
    });
  }
  return lines;
}

/** Перед первой записью composition: один ObjectId на строку materials[]. */
export function storedModuleMaterialLines(materials: LegacyModuleMaterial[] | undefined): CompositionLineDocumentShape[] {
  return previewModuleMaterialLines(materials).map((line) => ({ ...line, _id: new Types.ObjectId() }));
}

/** Чтение графа: legacy productModuleIds, пока composition пуст. */
export function previewProductModuleLines(ids: unknown[] | undefined): Array<Omit<CompositionLineDocumentShape, '_id'>> {
  const lines: Array<Omit<CompositionLineDocumentShape, '_id'>> = [];
  let sortOrder = 0;
  for (const raw of ids ?? []) {
    const moduleId = legacyRefId(raw);
    if (!Types.ObjectId.isValid(moduleId)) continue;
    lines.push({ lineType: 'module', refId: new Types.ObjectId(moduleId), quantity: 1, sortOrder });
    sortOrder += 1;
  }
  return lines;
}

/** Перед первой записью composition изделия: один ObjectId на модуль из productModuleIds. */
export function storedProductModuleLines(ids: unknown[] | undefined): CompositionLineDocumentShape[] {
  return previewProductModuleLines(ids).map((line) => ({ ...line, _id: new Types.ObjectId() }));
}

@Injectable()
export class CompositionLineService {
  toStoredLine(dto: CreateCompositionLineDto | UpdateCompositionLineDto, existing?: CompositionLineDocumentShape): CompositionLineDocumentShape {
    const lineType = dto.lineType ?? existing?.lineType;
    const refId = dto.refId ?? existing?.refId?.toString();
    if (!lineType || !refId || !Types.ObjectId.isValid(refId)) throw new BadRequestException('Строка состава: укажите тип (lineType) и ссылку на позицию (refId)');
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
      throw new BadRequestException('Свою цену (unitPriceOverride) можно указать только у строки-изделия');
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
        throw new BadRequestException('Своя цена (unitPriceOverride) — не меньше 0');
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
