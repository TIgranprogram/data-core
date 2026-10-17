import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WorkOrderOperation,
  WorkOrderOperationDocument,
} from './work-order-operation.schema';
import { CreateWorkOrderOperationDto } from './dto/create-work-order-operation.dto';
import { UpdateWorkOrderOperationDto } from './dto/update-work-order-operation.dto';

@Injectable()
export class WorkOrderOperationService {
  constructor(
    @InjectModel(WorkOrderOperation.name)
    private readonly model: Model<WorkOrderOperationDocument>,
  ) {}

  async create(
    dto: CreateWorkOrderOperationDto,
  ): Promise<WorkOrderOperationDocument> {
    return this.model.create({
      workOrderId: new Types.ObjectId(dto.workOrderId),
      operationId: dto.operationId ? new Types.ObjectId(dto.operationId) : undefined,
      statusId: dto.statusId ? new Types.ObjectId(dto.statusId) : undefined,
      completedBy: dto.completedBy ? new Types.ObjectId(dto.completedBy) : undefined,
      order: dto.order ?? 0,
      plannedDuration: dto.plannedDuration ?? 0,
      actualDuration: dto.actualDuration ?? 0,
      status: 'pending',
      notes: dto.notes,
    });
  }

  async findAll(workOrderId?: string): Promise<WorkOrderOperationDocument[]> {
    const filter: Record<string, unknown> = {};
    if (workOrderId) {
      if (!Types.ObjectId.isValid(workOrderId)) return [];
      filter.workOrderId = new Types.ObjectId(workOrderId);
    }
    return this.model.find(filter).sort({ workOrderId: 1, order: 1 }).exec();
  }

  async findById(id: string): Promise<WorkOrderOperationDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`WorkOrderOperation ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`WorkOrderOperation ${id} not found`);
    return doc;
  }

  async update(
    id: string,
    dto: UpdateWorkOrderOperationDto,
  ): Promise<WorkOrderOperationDocument> {
    const doc = await this.findById(id);
    if (dto.order !== undefined) doc.order = dto.order;
    if (dto.plannedDuration !== undefined) doc.plannedDuration = dto.plannedDuration;
    if (dto.actualDuration !== undefined) doc.actualDuration = dto.actualDuration;
    if (dto.notes !== undefined) doc.notes = dto.notes;
    return doc.save();
  }

  async start(id: string): Promise<WorkOrderOperationDocument> {
    const doc = await this.findById(id);
    doc.status = 'in_progress';
    doc.startedAt = new Date();
    return doc.save();
  }

  async complete(
    id: string,
    actualDuration?: number,
    completedBy?: string,
  ): Promise<WorkOrderOperationDocument> {
    const doc = await this.findById(id);
    doc.status = 'completed';
    doc.completedAt = new Date();
    if (actualDuration !== undefined) doc.actualDuration = actualDuration;
    if (completedBy) doc.completedBy = new Types.ObjectId(completedBy);
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
