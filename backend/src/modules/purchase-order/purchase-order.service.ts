import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PurchaseOrder,
  PurchaseOrderDocument,
  PurchaseOrderItem,
} from './purchase-order.schema';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { CounterService } from '../counter/counter.service';
import { StockMovementService } from '../stock-movement/stock-movement.service';
import { SessionRunner } from '../../common/db/session-runner';

@Injectable()
export class PurchaseOrderService {
  private readonly logger = new Logger(PurchaseOrderService.name);

  constructor(
    @InjectModel(PurchaseOrder.name)
    private readonly model: Model<PurchaseOrderDocument>,
    private readonly counter: CounterService,
    private readonly movementService: StockMovementService,
    private readonly sessionRunner: SessionRunner,
  ) {}

  async create(dto: CreatePurchaseOrderDto): Promise<PurchaseOrderDocument> {
    const items: PurchaseOrderItem[] = dto.items.map((it) => ({
      materialId: new Types.ObjectId(it.materialId),
      materialName: it.materialName,
      quantity: it.quantity,
      unit: it.unit,
      unitPrice: it.unitPrice,
      total: it.quantity * it.unitPrice,
      notes: it.notes,
    }));
    const totalAmount = items.reduce((s, i) => s + i.total, 0);
    return this.model.create({
      number: dto.number,
      title: dto.title,
      supplierId: new Types.ObjectId(dto.supplierId),
      warehouseId: dto.warehouseId
        ? new Types.ObjectId(dto.warehouseId)
        : undefined,
      deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : undefined,
      notes: dto.notes,
      items,
      totalAmount,
      status: 'pending',
    });
  }

  async findAll(
    supplierId?: string,
    status?: string,
  ): Promise<PurchaseOrderDocument[]> {
    const filter: Record<string, unknown> = {};
    if (supplierId) {
      if (!Types.ObjectId.isValid(supplierId)) return [];
      filter.supplierId = new Types.ObjectId(supplierId);
    }
    if (status) filter.status = status;
    return this.model
      .find(filter)
      .populate('supplierId')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findById(id: string): Promise<PurchaseOrderDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`PurchaseOrder ${id} not found`);
    }
    const doc = await this.model.findById(id).populate('supplierId').exec();
    if (!doc) throw new NotFoundException(`PurchaseOrder ${id} not found`);
    return doc;
  }

  async update(
    id: string,
    dto: UpdatePurchaseOrderDto,
  ): Promise<PurchaseOrderDocument> {
    const doc = await this.findById(id);
    if (dto.title !== undefined) doc.title = dto.title;
    if (dto.notes !== undefined) doc.notes = dto.notes;
    if (dto.deliveryDate !== undefined) {
      doc.deliveryDate = new Date(dto.deliveryDate);
    }
    if (dto.warehouseId !== undefined) {
      doc.warehouseId = dto.warehouseId
        ? new Types.ObjectId(dto.warehouseId)
        : (undefined as unknown as Types.ObjectId);
    }
    if (dto.items !== undefined) {
      doc.items = dto.items.map((it) => ({
        materialId: new Types.ObjectId(it.materialId),
        materialName: it.materialName,
        quantity: it.quantity,
        unit: it.unit,
        unitPrice: it.unitPrice,
        total: it.quantity * it.unitPrice,
        notes: it.notes,
      }));
      doc.totalAmount = doc.items.reduce((s, i) => s + i.total, 0);
    }
    return doc.save();
  }

  /** Receive = create in StockMovement per item, update status */
  async receive(id: string): Promise<PurchaseOrderDocument> {
    return this.sessionRunner.run(async (session) => {
      const doc = await this.model.findById(id).session(session).exec();
      if (!doc) throw new NotFoundException(`PurchaseOrder ${id} not found`);
      if (!doc.warehouseId) {
        throw new BadRequestException(
          `PurchaseOrder ${id} has no warehouseId; cannot receive`,
        );
      }
      for (const item of doc.items) {
        await this.movementService.create(
          {
            type: 'in',
            productId: item.materialId.toString(),
            warehouseId: doc.warehouseId.toString(),
            qty: item.quantity,
            cost: item.unitPrice,
            orderId: doc.number,
            documentRef: `PO:${doc.number}`,
          },
          session,
        );
      }
      doc.status = 'received';
      return doc.save({ session });
    });
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
