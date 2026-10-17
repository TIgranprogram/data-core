import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { StockMovement, StockMovementDocument } from './stock-movement.schema';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import {
  BatchInventoryInDto,
  InventoryBatchRowDto,
  type InventoryBatchResult,
} from './dto/batch-inventory-in.dto';
import { StorageItem, StorageItemDocument } from '../storage-item/storage-item.schema';
import { Material, MaterialDocument } from '../material/material.schema';
import { Product, ProductDocument } from '../product/product.schema';
import { Warehouse, WarehouseDocument } from '../warehouse/warehouse.schema';

type StockTarget = { productId?: string; materialId?: string };

@Injectable()
export class StockMovementService {
  private readonly logger = new Logger(StockMovementService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(StockMovement.name)
    private readonly model: Model<StockMovementDocument>,
    @InjectModel(StorageItem.name)
    private readonly storageModel: Model<StorageItemDocument>,
    @InjectModel(Material.name)
    private readonly materialModel: Model<MaterialDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Warehouse.name)
    private readonly warehouseModel: Model<WarehouseDocument>,
  ) {}

  async create(
    dto: CreateStockMovementDto,
    externalSession?: ClientSession,
  ): Promise<StockMovementDocument> {
    const target = this.resolveTarget(dto);
    if (dto.type === 'transfer' && !dto.toWarehouseId) {
      throw new BadRequestException('Transfer requires toWarehouseId');
    }
    // Z-001: if caller passes an external session, run on it (no nested txn).
    if (externalSession) {
      return this.runCreateGraph(dto, target, externalSession);
    }
    const session = await this.connection.startSession();
    let movement: StockMovementDocument | undefined;
    try {
      await session.withTransaction(async () => {
        movement = await this.runCreateGraph(dto, target, session);
      });
    } finally {
      await session.endSession();
    }
    if (!movement) throw new BadRequestException('Movement failed');
    return movement;
  }

  private async runCreateGraph(
    dto: CreateStockMovementDto,
    target: StockTarget,
    session: ClientSession,
  ): Promise<StockMovementDocument> {
    if (dto.type === 'in') {
      await this.applyIn(dto.warehouseId, target, dto.zoneName, dto.qty, session);
    } else if (dto.type === 'out') {
      await this.applyOut(dto.warehouseId, target, dto.zoneName, dto.qty, session);
    } else if (dto.type === 'transfer') {
      await this.applyTransfer(
        dto.warehouseId,
        dto.toWarehouseId!,
        target,
        dto.zoneName,
        dto.toZoneName,
        dto.qty,
        session,
      );
    }
    const [doc] = await this.model.create(
      [{
        type: dto.type,
        date: new Date(),
        productId: target.productId ? new Types.ObjectId(target.productId) : undefined,
        materialId: target.materialId ? new Types.ObjectId(target.materialId) : undefined,
        warehouseId: new Types.ObjectId(dto.warehouseId),
        toWarehouseId: dto.toWarehouseId ? new Types.ObjectId(dto.toWarehouseId) : undefined,
        zoneName: dto.zoneName,
        toZoneName: dto.toZoneName,
        qty: dto.qty,
        cost: dto.cost ?? 0,
        orderId: dto.orderId,
        documentRef: dto.documentRef,
        createdBy: dto.createdBy ? new Types.ObjectId(dto.createdBy) : undefined,
      }],
      { session },
    );
    if (!doc) throw new BadRequestException('Movement failed');
    return doc;
  }

  private async applyIn(
    warehouseId: string,
    target: StockTarget,
    zoneName: string | undefined,
    qty: number,
    session: ClientSession,
  ): Promise<void> {
    const filter = this.targetFilter(warehouseId, target, zoneName);
    let item = await this.storageModel.findOne(filter).session(session as never).exec();
    if (!item) {
      const [created] = await this.storageModel.create(
        [{
          warehouseId: new Types.ObjectId(warehouseId),
          productId: target.productId ? new Types.ObjectId(target.productId) : undefined,
          materialId: target.materialId ? new Types.ObjectId(target.materialId) : undefined,
          zoneName: zoneName ?? undefined,
          quantity: qty,
        }],
        { session: session as never },
      );
      item = created;
    } else {
      item.quantity = (item.quantity ?? 0) + qty;
      await item.save({ session: session as never });
    }
  }

  private async applyOut(
    warehouseId: string,
    target: StockTarget,
    zoneName: string | undefined,
    qty: number,
    session: ClientSession,
  ): Promise<void> {
    const item = await this.storageModel
      .findOne(this.targetFilter(warehouseId, target, zoneName))
      .session(session as never)
      .exec();
    if (!item) {
      throw new BadRequestException('Для выбранного товара нет позиции на складе');
    }
    if ((item.quantity ?? 0) < qty) {
      throw new BadRequestException(
        `Insufficient stock: have ${item.quantity}, requested ${qty}`,
      );
    }
    item.quantity = (item.quantity ?? 0) - qty;
    if ((item.reservedQty ?? 0) > 0) {
      item.reservedQty = Math.max(0, (item.reservedQty ?? 0) - qty);
    }
    await item.save({ session: session as never });
  }

  private async applyTransfer(
    fromWarehouseId: string,
    toWarehouseId: string,
    target: StockTarget,
    fromZone: string | undefined,
    toZone: string | undefined,
    qty: number,
    session: ClientSession,
  ): Promise<void> {
    await this.applyOut(fromWarehouseId, target, fromZone, qty, session);
    await this.applyIn(toWarehouseId, target, toZone, qty, session);
  }

  async findAll(
    warehouseId?: string,
    productId?: string,
    type?: string,
    from?: Date,
    to?: Date,
    materialId?: string,
  ): Promise<StockMovementDocument[]> {
    const filter: Record<string, unknown> = {};
    if (warehouseId) {
      if (!Types.ObjectId.isValid(warehouseId)) return [];
      filter.$or = [
        { warehouseId: new Types.ObjectId(warehouseId) },
        { toWarehouseId: new Types.ObjectId(warehouseId) },
      ];
    }
    if (productId) {
      if (!Types.ObjectId.isValid(productId)) return [];
      filter.productId = new Types.ObjectId(productId);
    }
    if (materialId) {
      if (!Types.ObjectId.isValid(materialId)) return [];
      filter.materialId = new Types.ObjectId(materialId);
    }
    if (type) filter.type = type;
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = from;
      if (to) range.$lte = to;
      filter.date = range;
    }
    // Journal is a historical record: resolve refs even if the product/material/
    // warehouse was archived or soft-deleted since — otherwise the soft-delete
    // plugin's default `deletedAt: null` filter (applied inside populate's own
    // find) silently blanks out the entry for anything archived after the fact.
    const includeSoftDeleted = { options: { includeSoftDeleted: true } };
    return this.model
      .find(filter)
      .populate({ path: 'productId', ...includeSoftDeleted })
      .populate({ path: 'materialId', ...includeSoftDeleted })
      .populate({ path: 'warehouseId', ...includeSoftDeleted })
      .populate({ path: 'toWarehouseId', ...includeSoftDeleted })
      .sort({ date: -1 })
      .exec();
  }

  async summary(period: 'day' | 'week' | 'month' = 'month') {
    const now = new Date();
    const from = new Date(now);
    if (period === 'day') from.setDate(from.getDate() - 1);
    else if (period === 'week') from.setDate(from.getDate() - 7);
    else from.setMonth(from.getMonth() - 1);
    const result = await this.model.aggregate([
      { $match: { date: { $gte: from } } },
      {
        $group: {
          _id: '$type',
          totalQty: { $sum: '$qty' },
          totalAmount: { $sum: { $multiply: ['$qty', '$cost'] } },
        },
      },
    ]).exec();
    return result.map((r) => ({ type: r._id, totalQty: r.totalQty, totalAmount: r.totalAmount }));
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    // Z-001 (variant a): compensating reverse-movement + soft-delete in one txn.
    const session = await this.connection.startSession();
    try {
      session.startTransaction();
      const origin = await this.model
        .findById(new Types.ObjectId(id))
        .session(session)
        .exec();
      if (!origin || (origin as unknown as { deletedAt?: Date }).deletedAt) {
        await session.abortTransaction();
        return;
      }
      const reverse: Record<string, unknown> = {
        date: new Date(),
        qty: origin.qty,
        cost: origin.cost ?? 0,
        orderId: origin.orderId,
        documentRef:
          origin.type === 'transfer'
            ? `REVTR:${origin._id.toString()}`
            : `REV:${origin._id.toString()}`,
      };
      if (origin.type === 'in') reverse.type = 'out';
      else if (origin.type === 'out') reverse.type = 'in';
      else if (origin.type === 'transfer') {
        reverse.type = 'transfer';
        reverse.warehouseId = origin.toWarehouseId;
        reverse.toWarehouseId = origin.warehouseId;
        reverse.zoneName = origin.toZoneName;
        reverse.toZoneName = origin.zoneName;
      } else {
        reverse.type = origin.type;
      }
      if (!reverse.warehouseId) reverse.warehouseId = origin.warehouseId;
      if (reverse.zoneName === undefined) reverse.zoneName = origin.zoneName;
      if (origin.productId) reverse.productId = origin.productId;
      if (origin.materialId) reverse.materialId = origin.materialId;
      await this.model.create([reverse], { session });
      await this.model.updateOne(
        { _id: origin._id },
        { $set: { deletedAt: new Date() } },
        { session },
      );
      await session.commitTransaction();
    } catch (e) {
      await session.abortTransaction();
      throw e;
    } finally {
      await session.endSession();
    }
  }

  /**
   * TZ-NX-WH-INV-BE-BATCH — bulk physical-count IN. Each row is resolved
   * (nomenclature + warehouse) and then written through the SAME
   * `create()` this class already exposes — one atomic transaction per
   * row, exactly like a single manual «+ Приход». Partial success by
   * design (documented, not all-or-nothing): a bad row is reported at
   * its index in `errors[]` and does not block the rows around it.
   */
  async batchInventoryIn(dto: BatchInventoryInDto): Promise<InventoryBatchResult> {
    const errors: { index: number; message: string }[] = [];
    let created = 0;
    for (let index = 0; index < dto.rows.length; index += 1) {
      const row = dto.rows[index];
      try {
        const target = await this.resolveInventoryTarget(row);
        const warehouseId = await this.resolveInventoryWarehouse(row);
        await this.create({
          type: 'in',
          qty: row.qty,
          warehouseId,
          documentRef: row.documentRef ?? dto.documentRef,
          ...target,
        } as CreateStockMovementDto);
        created += 1;
      } catch (err) {
        errors.push({
          index,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { created, errors };
  }

  /** Explicit id wins; otherwise article (Material) then sku (Material, then Product). */
  private async resolveInventoryTarget(row: InventoryBatchRowDto): Promise<StockTarget> {
    if (row.materialId && row.productId) {
      throw new BadRequestException('Укажите либо materialId, либо productId — не оба');
    }
    if (row.materialId) {
      const exists = await this.materialModel
        .exists({ _id: new Types.ObjectId(row.materialId), deletedAt: null })
        .exec();
      if (!exists) throw new BadRequestException(`Материал ${row.materialId} не найден`);
      return { materialId: row.materialId };
    }
    if (row.productId) {
      const exists = await this.productModel
        .exists({ _id: new Types.ObjectId(row.productId), deletedAt: null })
        .exec();
      if (!exists) throw new BadRequestException(`Товар ${row.productId} не найден`);
      return { productId: row.productId };
    }
    if (row.article) {
      const material = await this.materialModel
        .findOne({ article: row.article, deletedAt: null })
        .exec();
      if (material) return { materialId: material._id.toString() };
    }
    if (row.sku) {
      const material = await this.materialModel
        .findOne({ sku: row.sku, deletedAt: null })
        .exec();
      if (material) return { materialId: material._id.toString() };
      const product = await this.productModel
        .findOne({ sku: row.sku, deletedAt: null })
        .exec();
      if (product) return { productId: product._id.toString() };
    }
    const key = row.article ?? row.sku;
    if (!key) {
      throw new BadRequestException('Укажите materialId/productId либо article/sku');
    }
    throw new BadRequestException(`Не найдено по article/sku «${key}»`);
  }

  private async resolveInventoryWarehouse(row: InventoryBatchRowDto): Promise<string> {
    if (row.warehouseId) {
      const warehouse = await this.warehouseModel
        .findOne({ _id: new Types.ObjectId(row.warehouseId), deletedAt: null })
        .exec();
      if (!warehouse) throw new BadRequestException(`Склад ${row.warehouseId} не найден`);
      return warehouse._id.toString();
    }
    if (row.warehouseName) {
      const warehouse = await this.warehouseModel
        .findOne({ name: new RegExp(`^${this.escapeRegex(row.warehouseName)}$`, 'i'), deletedAt: null })
        .exec();
      if (!warehouse) throw new BadRequestException(`Склад «${row.warehouseName}» не найден`);
      return warehouse._id.toString();
    }
    const def = await this.warehouseModel.findOne({ isDefault: true, deletedAt: null }).exec();
    if (!def) {
      throw new BadRequestException('Склад не указан, и нет склада по умолчанию');
    }
    return def._id.toString();
  }

  /** Escape user input for safe inclusion in a RegExp. */
  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private resolveTarget(dto: Pick<CreateStockMovementDto, 'productId' | 'materialId'>): StockTarget {
    const hasProduct = Boolean(dto.productId);
    const hasMaterial = Boolean(dto.materialId);
    if (hasProduct === hasMaterial) {
      throw new BadRequestException(
        'Движение должно ссылаться ровно на продукт или материал',
      );
    }
    const id = hasProduct ? dto.productId : dto.materialId;
    if (!Types.ObjectId.isValid(id!)) throw new BadRequestException('Некорректный идентификатор складской позиции');
    return { productId: dto.productId, materialId: dto.materialId };
  }

  private targetFilter(
    warehouseId: string,
    target: StockTarget,
    zoneName?: string,
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = {
      warehouseId: new Types.ObjectId(warehouseId),
      ...(target.productId
        ? { productId: new Types.ObjectId(target.productId) }
        : { materialId: new Types.ObjectId(target.materialId!) }),
    };
    if (zoneName) filter.zoneName = zoneName;
    else filter.$or = [{ zoneName: { $exists: false } }, { zoneName: null }];
    return filter;
  }
}
