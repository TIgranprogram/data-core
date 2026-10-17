import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ActualCost, ActualCostDocument } from './actual-cost.schema';
import { CreateActualCostDto } from './dto/create-actual-cost.dto';
import {
  CostCalculation,
  CostCalculationDocument,
} from '../cost-calculation/cost-calculation.schema';
import {
  ProductionOrder,
  ProductionOrderDocument,
} from '../production-order/production-order.schema';

@Injectable()
export class ActualCostService {
  constructor(
    @InjectModel(ActualCost.name)
    private readonly model: Model<ActualCostDocument>,
    @InjectModel(CostCalculation.name)
    private readonly costModel: Model<CostCalculationDocument>,
    @InjectModel(ProductionOrder.name)
    private readonly orderModel: Model<ProductionOrderDocument>,
  ) {}

  async create(dto: CreateActualCostDto): Promise<ActualCostDocument> {
    return this.model.create({
      orderId: new Types.ObjectId(dto.orderId),
      type: dto.type,
      amount: dto.amount,
      description: dto.description,
      sourceRef: dto.sourceRef,
      date: dto.date ? new Date(dto.date) : new Date(),
      createdBy: dto.createdBy ? new Types.ObjectId(dto.createdBy) : undefined,
    });
  }

  async findAll(orderId: string): Promise<ActualCostDocument[]> {
    if (!Types.ObjectId.isValid(orderId)) return [];
    return this.model
      .find({ orderId: new Types.ObjectId(orderId) })
      .sort({ date: -1 })
      .exec();
  }

  async costComparison(orderId: string): Promise<{
    planned: number;
    actual: number;
    variance: number;
  }> {
    if (!Types.ObjectId.isValid(orderId)) {
      return { planned: 0, actual: 0, variance: 0 };
    }
    const orderObjectId = new Types.ObjectId(orderId);
    const order = await this.orderModel.findById(orderObjectId).exec();
    if (!order) return { planned: 0, actual: 0, variance: 0 };
    const [plannedDoc, actuals] = await Promise.all([
      this.costModel
        .findOne({ productId: order.productId, isActive: true })
        .sort({ createdAt: -1 })
        .exec(),
      this.model.find({ orderId: orderObjectId }).exec(),
    ]);
    const planned = plannedDoc?.totalCost ?? 0;
    const actual = actuals.reduce((s, a) => s + (a.amount ?? 0), 0);
    return { planned, actual, variance: actual - planned };
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    await this.model
      .updateOne({ _id: new Types.ObjectId(id) }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
