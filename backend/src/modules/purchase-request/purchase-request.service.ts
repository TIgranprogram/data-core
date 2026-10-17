import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PurchaseRequest,
  PurchaseRequestDocument,
  PurchaseRequestItem,
} from './purchase-request.schema';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';
import { UpdatePurchaseRequestDto } from './dto/update-purchase-request.dto';
import { CounterService } from '../counter/counter.service';
import {
  PurchaseOrder,
  PurchaseOrderDocument,
} from '../purchase-order/purchase-order.schema';

@Injectable()
export class PurchaseRequestService {
  constructor(
    @InjectModel(PurchaseRequest.name)
    private readonly model: Model<PurchaseRequestDocument>,
    @InjectModel(PurchaseOrder.name)
    private readonly orderModel: Model<PurchaseOrderDocument>,
    private readonly counter: CounterService,
  ) {}

  async create(dto: CreatePurchaseRequestDto): Promise<PurchaseRequestDocument> {
    const number = await this.counter.next('PurchaseRequest', 'PR');
    const items: PurchaseRequestItem[] = (dto.items ?? []).map((it) => ({
      materialId: new Types.ObjectId(it.materialId),
      materialName: it.materialName,
      quantity: it.quantity,
      unit: it.unit,
      estimatedPrice: it.estimatedPrice ?? 0,
    }));
    const totalAmount = items.reduce(
      (s, i) => s + (i.quantity ?? 0) * (i.estimatedPrice ?? 0),
      0,
    );
    return this.model.create({
      number,
      date: dto.date ? new Date(dto.date) : new Date(),
      title: dto.title,
      createdBy: dto.createdBy ? new Types.ObjectId(dto.createdBy) : undefined,
      orderId: dto.orderId ? new Types.ObjectId(dto.orderId) : undefined,
      sourceType: dto.sourceType,
      sourceId: dto.sourceId,
      entityType: dto.entityType,
      entityId: dto.entityId,
      entityName: dto.entityName,
      entitySku: dto.entitySku,
      entityUnit: dto.entityUnit,
      quantity: dto.quantity ?? 0,
      warehouseId: dto.warehouseId ? new Types.ObjectId(dto.warehouseId) : undefined,
      zoneName: dto.zoneName,
      notes: dto.notes,
      items,
      totalAmount,
      status: 'pending',
    });
  }

  async findAll(status?: string): Promise<PurchaseRequestDocument[]> {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    return this.model.find(filter).sort({ date: -1 }).exec();
  }

  async findById(id: string): Promise<PurchaseRequestDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`PurchaseRequest ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`PurchaseRequest ${id} not found`);
    return doc;
  }

  async update(
    id: string,
    dto: UpdatePurchaseRequestDto,
  ): Promise<PurchaseRequestDocument> {
    const doc = await this.findById(id);
    if (dto.title !== undefined) doc.title = dto.title;
    if (dto.notes !== undefined) doc.notes = dto.notes;
    if (dto.status !== undefined && (dto as { status?: string }).status) {
      (doc as unknown as { status: string }).status = (dto as { status?: string }).status!;
    }
    if (dto.warehouseId !== undefined) {
      doc.warehouseId = dto.warehouseId
        ? new Types.ObjectId(dto.warehouseId)
        : (undefined as unknown as Types.ObjectId);
    }
    return doc.save();
  }

  async convertToPurchaseOrder(
    id: string,
    supplierId: string,
    title?: string,
  ): Promise<{ pr: PurchaseRequestDocument; po: PurchaseOrderDocument }> {
    const pr = await this.findById(id);
    if (pr.status === 'converted') {
      throw new NotFoundException(`PurchaseRequest already converted`);
    }
    const number = await this.counter.next('PurchaseOrder', 'PO');
    const items = pr.items.map((i) => ({
      materialId: i.materialId,
      materialName: i.materialName,
      quantity: i.quantity,
      unit: i.unit,
      unitPrice: i.estimatedPrice ?? 0,
      total: (i.quantity ?? 0) * (i.estimatedPrice ?? 0),
    }));
    const totalAmount = items.reduce((s, i) => s + i.total, 0);
    const po = await this.orderModel.create({
      number,
      title: title ?? pr.title ?? `PO from ${pr.number}`,
      supplierId: new Types.ObjectId(supplierId),
      status: 'pending',
      items,
      totalAmount,
    });
    pr.status = 'converted';
    pr.convertedPurchaseOrderId = po._id.toString();
    await pr.save();
    return { pr, po };
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
