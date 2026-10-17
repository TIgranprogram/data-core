import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { OrderClosing, OrderClosingDocument } from './order-closing.schema';
import { CreateOrderClosingDto } from './dto/create-order-closing.dto';
import { OrderTask, OrderTaskDocument } from '../order-task/order-task.schema';
import {
  ProductionOrder,
  ProductionOrderDocument,
} from '../production-order/production-order.schema';

@Injectable()
export class OrderClosingService {
  constructor(
    @InjectModel(OrderClosing.name)
    private readonly model: Model<OrderClosingDocument>,
    @InjectModel(OrderTask.name)
    private readonly orderTaskModel: Model<OrderTaskDocument>,
    @InjectModel(ProductionOrder.name)
    private readonly orderModel: Model<ProductionOrderDocument>,
  ) {}

  async create(dto: CreateOrderClosingDto): Promise<OrderClosingDocument> {
    // Verify all tasks completed
    const incomplete = await this.orderTaskModel
      .countDocuments({
        productionOrderId: new Types.ObjectId(dto.productionOrderId),
        status: { $nin: ['completed', 'skipped'] },
      })
      .exec();
    if (incomplete > 0) {
      throw new BadRequestException(
        `Cannot close order with ${incomplete} incomplete task(s)`,
      );
    }
    const doc = await this.model.create({
      productionOrderId: new Types.ObjectId(dto.productionOrderId),
      closingType: dto.closingType,
      number: dto.number,
      date: new Date(dto.date),
      amount: dto.amount ?? 0,
      totalAmount: dto.totalAmount ?? dto.amount ?? 0,
      organizationId: dto.organizationId
        ? new Types.ObjectId(dto.organizationId)
        : undefined,
      status: 'draft',
      fileUrl: dto.fileUrl,
      notes: dto.notes,
    });
    // Also mark production order as closed
    await this.orderModel
      .updateOne(
        { _id: new Types.ObjectId(dto.productionOrderId) },
        { $set: { status: 'closed', actualEndDate: new Date() } },
      )
      .exec();
    return doc;
  }

  async findAll(productionOrderId?: string): Promise<OrderClosingDocument[]> {
    const filter: Record<string, unknown> = {};
    if (productionOrderId) {
      if (!Types.ObjectId.isValid(productionOrderId)) return [];
      filter.productionOrderId = new Types.ObjectId(productionOrderId);
    }
    return this.model.find(filter).sort({ date: -1 }).exec();
  }

  async findById(id: string): Promise<OrderClosingDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`OrderClosing ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`OrderClosing ${id} not found`);
    return doc;
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
