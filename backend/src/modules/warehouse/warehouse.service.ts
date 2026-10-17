import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Warehouse, WarehouseDocument } from './warehouse.schema';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import {
  StorageItem,
  StorageItemDocument,
} from '../storage-item/storage-item.schema';
import {
  StockMovement,
  StockMovementDocument,
} from '../stock-movement/stock-movement.schema';

@Injectable()
export class WarehouseService {
  constructor(
    @InjectModel(Warehouse.name)
    private readonly model: Model<WarehouseDocument>,
    @InjectModel(StorageItem.name)
    private readonly storageModel: Model<StorageItemDocument>,
    @InjectModel(StockMovement.name)
    private readonly movementModel: Model<StockMovementDocument>,
  ) {}

  async create(dto: CreateWarehouseDto): Promise<WarehouseDocument> {
    const doc = await this.model.create({
      ...dto,
      type: dto.type ?? 'main',
      isActive: dto.isActive ?? true,
      isDefault: false,
      roleIds: (dto.roleIds ?? []).map((id) => new Types.ObjectId(id)),
    });
    if (dto.isDefault) return this.setDefault(doc._id.toString());
    return doc;
  }

  async findAll(): Promise<WarehouseDocument[]> {
    return this.model
      .find({ $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] })
      .sort({ name: 1 })
      .exec();
  }

  async findById(id: string): Promise<WarehouseDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Warehouse ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`Warehouse ${id} not found`);
    return doc;
  }

  async update(
    id: string,
    dto: UpdateWarehouseDto,
  ): Promise<WarehouseDocument> {
    const doc = await this.findById(id);
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.type !== undefined) doc.type = dto.type;
    if (dto.address !== undefined) doc.address = dto.address;
    if (dto.description !== undefined) doc.description = dto.description;
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    if (dto.zoneNames !== undefined) doc.zoneNames = dto.zoneNames;
    if (dto.roleIds !== undefined) {
      doc.roleIds = dto.roleIds.map((id) => new Types.ObjectId(id));
    }
    if (dto.isDefault !== undefined) {
      if (dto.isDefault) await this.clearOtherDefaults(doc._id);
      doc.isDefault = dto.isDefault;
    }
    return doc.save();
  }

  /** Atomically makes `id` the sole default warehouse (unsets all others first). */
  async setDefault(id: string): Promise<WarehouseDocument> {
    const doc = await this.findById(id);
    await this.clearOtherDefaults(doc._id);
    doc.isDefault = true;
    return doc.save();
  }

  /** S4 receive→stock — resolve the warehouse to default to when the operator doesn't pick one. */
  async findDefault(): Promise<WarehouseDocument | null> {
    return this.model
      .findOne({
        isDefault: true,
        $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
      })
      .exec();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }

  private async clearOtherDefaults(excludeId: Types.ObjectId): Promise<void> {
    await this.model
      .updateMany({ _id: { $ne: excludeId } }, { $set: { isDefault: false } })
      .exec();
  }

  async inventory(warehouseId: string): Promise<StorageItemDocument[]> {
    if (!Types.ObjectId.isValid(warehouseId)) return [];
    return this.storageModel
      .find({ warehouseId: new Types.ObjectId(warehouseId) })
      .populate('productId')
      .sort({ name: 1 })
      .exec();
  }

  async movements(
    warehouseId: string,
    from?: Date,
    to?: Date,
  ): Promise<StockMovementDocument[]> {
    if (!Types.ObjectId.isValid(warehouseId)) return [];
    const filter: Record<string, unknown> = {
      $or: [
        { warehouseId: new Types.ObjectId(warehouseId) },
        { toWarehouseId: new Types.ObjectId(warehouseId) },
      ],
    };
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = from;
      if (to) range.$lte = to;
      filter.date = range;
    }
    return this.movementModel
      .find(filter)
      .populate('productId')
      .sort({ date: -1 })
      .exec();
  }

  async zones(warehouseId: string): Promise<string[]> {
    const doc = await this.findById(warehouseId);
    if (doc.zoneNames.length > 0) return doc.zoneNames;
    // Otherwise derive from StorageItem.zoneName
    const items = await this.storageModel
      .distinct('zoneName', {
        warehouseId: new Types.ObjectId(warehouseId),
      })
      .exec();
    return items.filter((z): z is string => typeof z === 'string');
  }
}
