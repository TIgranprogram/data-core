import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WorkOrder, WorkOrderDocument } from './work-order.schema';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { CounterService } from '../counter/counter.service';
import {
  WorkOrderOperation,
  WorkOrderOperationDocument,
} from '../work-order-operation/work-order-operation.schema';

@Injectable()
export class WorkOrderService {
  constructor(
    @InjectModel(WorkOrder.name)
    private readonly model: Model<WorkOrderDocument>,
    @InjectModel(WorkOrderOperation.name)
    private readonly opModel: Model<WorkOrderOperationDocument>,
    private readonly counter: CounterService,
  ) {}

  async create(dto: CreateWorkOrderDto): Promise<WorkOrderDocument> {
    const number = await this.counter.next('WorkOrder', 'WO');
    return this.model.create({
      number,
      orderId: new Types.ObjectId(dto.orderId),
      productId: new Types.ObjectId(dto.productId),
      qty: dto.qty,
      statusId: dto.statusId ? new Types.ObjectId(dto.statusId) : undefined,
      assignedTo: dto.assignedTo ? new Types.ObjectId(dto.assignedTo) : undefined,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      notes: dto.notes,
      isActive: true,
    });
  }

  async findAll(): Promise<WorkOrderDocument[]> {
    return this.model
      .find()
      .populate('orderId')
      .populate('productId')
      .populate('assignedTo')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findById(id: string): Promise<WorkOrderDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`WorkOrder ${id} not found`);
    }
    const doc = await this.model
      .findById(id)
      .populate('orderId')
      .populate('productId')
      .populate('assignedTo')
      .exec();
    if (!doc) throw new NotFoundException(`WorkOrder ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateWorkOrderDto): Promise<WorkOrderDocument> {
    const doc = await this.findById(id);
    if (dto.qty !== undefined) doc.qty = dto.qty;
    if (dto.statusId !== undefined) {
      doc.statusId = dto.statusId ? new Types.ObjectId(dto.statusId) : (undefined as unknown as Types.ObjectId);
    }
    if (dto.assignedTo !== undefined) {
      doc.assignedTo = dto.assignedTo ? new Types.ObjectId(dto.assignedTo) : (undefined as unknown as Types.ObjectId);
    }
    if (dto.startDate !== undefined) doc.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) doc.endDate = new Date(dto.endDate);
    if (dto.notes !== undefined) doc.notes = dto.notes;
    return doc.save();
  }

  async complete(id: string): Promise<WorkOrderDocument> {
    const doc = await this.findById(id);
    await this.opModel
      .updateMany(
        { workOrderId: doc._id, status: { $ne: 'completed' } },
        { $set: { status: 'completed', completedAt: new Date() } },
      )
      .exec();
    doc.isActive = false;
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
