import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { OrderTask, OrderTaskDocument } from './order-task.schema';
import { CreateOrderTaskDto } from './dto/create-order-task.dto';
import { UpdateOrderTaskDto } from './dto/update-order-task.dto';

@Injectable()
export class OrderTaskService {
  constructor(
    @InjectModel(OrderTask.name)
    private readonly model: Model<OrderTaskDocument>,
  ) {}

  async create(dto: CreateOrderTaskDto): Promise<OrderTaskDocument> {
    return this.model.create({
      ...dto,
      productionOrderId: new Types.ObjectId(dto.productionOrderId),
      componentId: dto.componentId ? new Types.ObjectId(dto.componentId) : undefined,
      workTypeId: dto.workTypeId ? new Types.ObjectId(dto.workTypeId) : undefined,
      workerId: dto.workerId ? new Types.ObjectId(dto.workerId) : undefined,
      workCenterId: dto.workCenterId ? new Types.ObjectId(dto.workCenterId) : undefined,
      dependsOnTaskIds: (dto.dependsOnTaskIds ?? []).map((id) => new Types.ObjectId(id)),
    });
  }

  async findAll(
    productionOrderId?: string,
    status?: string,
  ): Promise<OrderTaskDocument[]> {
    const filter: Record<string, unknown> = {};
    if (productionOrderId) {
      if (!Types.ObjectId.isValid(productionOrderId)) return [];
      filter.productionOrderId = new Types.ObjectId(productionOrderId);
    }
    if (status) filter.status = status;
    return this.model
      .find(filter)
      .sort({ productionOrderId: 1, sortOrder: 1 })
      .exec();
  }

  async findReady(workerId?: string): Promise<OrderTaskDocument[]> {
    const filter: Record<string, unknown> = { status: 'pending' };
    if (workerId) {
      if (!Types.ObjectId.isValid(workerId)) return [];
      filter.workerId = new Types.ObjectId(workerId);
    }
    const all = await this.model.find(filter).sort({ sortOrder: 1 }).exec();
    // Filter to those with all deps completed
    const depIds = all.flatMap((t) => t.dependsOnTaskIds);
    if (depIds.length === 0) return all;
    const depStatuses = await this.model
      .find({ _id: { $in: depIds } }, { status: 1 })
      .exec();
    const statusById = new Map(
      depStatuses.map((d) => [d._id.toString(), d.status]),
    );
    return all.filter((t) =>
      t.dependsOnTaskIds.every((depId) => {
        const s = statusById.get(depId.toString());
        return s === 'completed' || s === 'skipped';
      }),
    );
  }

  async findById(id: string): Promise<OrderTaskDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`OrderTask ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`OrderTask ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateOrderTaskDto): Promise<OrderTaskDocument> {
    const doc = await this.findById(id);
    if (dto.status !== undefined) doc.status = dto.status;
    if (dto.actualHours !== undefined) doc.actualHours = dto.actualHours;
    if (dto.actualStartDate !== undefined) doc.actualStartDate = new Date(dto.actualStartDate);
    if (dto.actualEndDate !== undefined) doc.actualEndDate = new Date(dto.actualEndDate);
    if (dto.workerId !== undefined) {
      doc.workerId = dto.workerId ? new Types.ObjectId(dto.workerId) : (undefined as unknown as Types.ObjectId);
    }
    if (dto.notes !== undefined) doc.notes = dto.notes;
    return doc.save();
  }

  async complete(id: string, actualHours?: number): Promise<OrderTaskDocument> {
    const doc = await this.findById(id);
    // Check all dependsOnTaskIds are completed
    if (doc.dependsOnTaskIds.length > 0) {
      const incomplete = await this.model
        .countDocuments({
          _id: { $in: doc.dependsOnTaskIds },
          status: { $nin: ['completed', 'skipped'] },
        })
        .exec();
      if (incomplete > 0) {
        throw new BadRequestException(
          `Cannot complete: ${incomplete} dependent task(s) not yet completed`,
        );
      }
    }
    doc.status = 'completed';
    doc.actualEndDate = new Date();
    if (!doc.actualStartDate) doc.actualStartDate = new Date();
    if (actualHours !== undefined) doc.actualHours = actualHours;
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
