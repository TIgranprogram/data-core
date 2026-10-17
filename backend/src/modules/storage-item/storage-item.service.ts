import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { StorageItem, StorageItemDocument } from './storage-item.schema';
import { CreateStorageItemDto } from './dto/create-storage-item.dto';
import { UpdateStorageItemDto } from './dto/update-storage-item.dto';
import { AdjustStorageItemDto } from './dto/adjust-storage-item.dto';
import { StockMovement, StockMovementDocument } from '../stock-movement/stock-movement.schema';

@Injectable()
export class StorageItemService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(StorageItem.name)
    private readonly model: Model<StorageItemDocument>,
    @InjectModel(StockMovement.name)
    private readonly movementModel: Model<StockMovementDocument>,
  ) {}

  async create(dto: CreateStorageItemDto): Promise<StorageItemDocument> {
    const target = this.resolveTarget(dto);
    return this.model.create({
      ...dto,
      warehouseId: new Types.ObjectId(dto.warehouseId),
      productId: target.productId ? new Types.ObjectId(target.productId) : undefined,
      materialId: target.materialId ? new Types.ObjectId(target.materialId) : undefined,
      isActive: dto.isActive ?? true,
      quantity: dto.quantity ?? 0,
      reservedQty: dto.reservedQty ?? 0,
      minQuantity: dto.minQuantity ?? 0,
    });
  }

  async findAll(
    warehouseId?: string,
    productId?: string,
    lowStock?: boolean,
    materialId?: string,
  ): Promise<StorageItemDocument[]> {
    const filter: Record<string, unknown> = {};
    if (warehouseId) {
      if (!Types.ObjectId.isValid(warehouseId)) return [];
      filter.warehouseId = new Types.ObjectId(warehouseId);
    }
    if (productId) {
      if (!Types.ObjectId.isValid(productId)) return [];
      filter.productId = new Types.ObjectId(productId);
    }
    if (materialId) {
      if (!Types.ObjectId.isValid(materialId)) return [];
      filter.materialId = new Types.ObjectId(materialId);
    }
    if (lowStock) filter.$expr = { $lt: ['$quantity', '$minQuantity'] };

    // A warehouse balance can outlive the catalog record it points to (product
    // archived while stock still sits on the shelf) — resolve it anyway so the
    // operator still sees what's physically there, per the soft-delete plugin's
    // `includeSoftDeleted` escape hatch.
    const includeSoftDeleted = { options: { includeSoftDeleted: true } };
    return this.model
      .find(filter)
      .populate({ path: 'productId', ...includeSoftDeleted })
      .populate({ path: 'materialId', ...includeSoftDeleted })
      .populate({ path: 'warehouseId', ...includeSoftDeleted })
      .sort({ name: 1 })
      .exec();
  }

  async findById(id: string): Promise<StorageItemDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`StorageItem ${id} not found`);
    }
    const doc = await this.model
      .findById(id)
      .populate({ path: 'productId', options: { includeSoftDeleted: true } })
      .populate({ path: 'materialId', options: { includeSoftDeleted: true } })
      .populate({ path: 'warehouseId', options: { includeSoftDeleted: true } })
      .exec();
    if (!doc) throw new NotFoundException(`StorageItem ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateStorageItemDto): Promise<StorageItemDocument> {
    const doc = await this.findById(id);
    if (dto.productId !== undefined || dto.materialId !== undefined) {
      const target = this.resolveTarget({
        productId: dto.productId ?? doc.productId?.toString(),
        materialId: dto.materialId ?? doc.materialId?.toString(),
      });
      doc.productId = target.productId ? new Types.ObjectId(target.productId) : undefined;
      doc.materialId = target.materialId ? new Types.ObjectId(target.materialId) : undefined;
    }
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.description !== undefined) doc.description = dto.description;
    if (dto.zoneName !== undefined) doc.zoneName = dto.zoneName;
    if (dto.minQuantity !== undefined) doc.minQuantity = dto.minQuantity;
    if (dto.weightKg !== undefined) doc.weightKg = dto.weightKg;
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    if (dto.photos !== undefined) doc.photos = dto.photos;
    return doc.save();
  }

  async adjust(id: string, dto: AdjustStorageItemDto): Promise<StorageItemDocument> {
    const session = await this.connection.startSession();
    let result: StorageItemDocument | undefined;
    try {
      await session.withTransaction(async () => {
        if (!Types.ObjectId.isValid(id)) {
          throw new NotFoundException(`StorageItem ${id} not found`);
        }
        const doc = await this.model.findById(id).session(session).exec();
        if (!doc) throw new NotFoundException(`StorageItem ${id} not found`);
        const newQty = (doc.quantity ?? 0) + dto.delta;
        if (newQty < 0) {
          throw new BadRequestException(`Cannot adjust: resulting quantity would be ${newQty}`);
        }
        doc.quantity = newQty;
        await doc.save({ session });
        await this.movementModel.create(
          [{
            type: 'adjust',
            productId: doc.productId,
            materialId: doc.materialId,
            warehouseId: doc.warehouseId,
            zoneName: doc.zoneName,
            qty: Math.abs(dto.delta),
            documentRef: `ADJUST:${dto.reason}`,
            date: new Date(),
          }],
          { session },
        );
        result = doc;
      });
    } finally {
      await session.endSession();
    }
    if (!result) throw new NotFoundException('Adjust failed');
    return result;
  }

  async remove(id: string): Promise<void> {
    // Schema has no `deletedAt` — soft-delete via $set was a silent no-op
    // (Mongoose strict strips the unknown path), leaving rows behind and
    // blocking unique partial indexes. Hard delete matches the collection.
    const doc = await this.findById(id);
    await this.model.deleteOne({ _id: doc._id }).exec();
  }

  private resolveTarget(dto: Pick<CreateStorageItemDto, 'productId' | 'materialId'>): {
    productId?: string;
    materialId?: string;
  } {
    const hasProduct = Boolean(dto.productId);
    const hasMaterial = Boolean(dto.materialId);
    if (hasProduct === hasMaterial) {
      throw new BadRequestException(
        'Складская позиция должна ссылаться ровно на продукт или материал',
      );
    }
    if (hasProduct && !Types.ObjectId.isValid(dto.productId!)) {
      throw new BadRequestException('Некорректный productId');
    }
    if (hasMaterial && !Types.ObjectId.isValid(dto.materialId!)) {
      throw new BadRequestException('Некорректный materialId');
    }
    return { productId: dto.productId, materialId: dto.materialId };
  }
}
