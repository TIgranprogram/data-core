import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import {
  ProductionOrder,
  ProductionOrderDocument,
} from './production-order.schema';
import { CreateProductionOrderDto } from './dto/create-production-order.dto';
import { UpdateProductionOrderDto } from './dto/update-production-order.dto';
import { CounterService } from '../counter/counter.service';
import { Product, ProductDocument } from '../product/product.schema';
import { TechProcess, TechProcessDocument } from '../tech-process/tech-process.schema';
import { Bom, BomDocument } from '../bom/bom.schema';
import { OrderTask, OrderTaskDocument } from '../order-task/order-task.schema';

@Injectable()
export class ProductionOrderService {
  private readonly logger = new Logger(ProductionOrderService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(ProductionOrder.name)
    private readonly model: Model<ProductionOrderDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(TechProcess.name)
    private readonly techProcessModel: Model<TechProcessDocument>,
    @InjectModel(Bom.name)
    private readonly bomModel: Model<BomDocument>,
    @InjectModel(OrderTask.name)
    private readonly orderTaskModel: Model<OrderTaskDocument>,
    private readonly counter: CounterService,
  ) {}

  async create(dto: CreateProductionOrderDto): Promise<ProductionOrderDocument> {
    const product = await this.productModel.findById(dto.productId).exec();
    if (!product) {
      throw new NotFoundException(`Product ${dto.productId} not found`);
    }

    const session = await this.connection.startSession();
    const created: ProductionOrderDocument[] = [];
    try {
      await session.withTransaction(async () => {
        const number = await this.counter.next('ProductionOrder', 'PO');
        const [doc] = await this.model.create(
          [
            {
              number,
              productId: new Types.ObjectId(dto.productId),
              productName: product.name,
              productSku: product.sku,
              quantity: dto.quantity,
              title: dto.title,
              ralCode: dto.ralCode,
              notes: dto.notes,
              packageTag: dto.packageTag,
              workCenterId: dto.workCenterId
                ? new Types.ObjectId(dto.workCenterId)
                : undefined,
              workTypeId: dto.workTypeId
                ? new Types.ObjectId(dto.workTypeId)
                : undefined,
              contractId: dto.contractId
                ? new Types.ObjectId(dto.contractId)
                : undefined,
              proposalId: dto.proposalId
                ? new Types.ObjectId(dto.proposalId)
                : undefined,
              plannedStartDate: dto.plannedStartDate
                ? new Date(dto.plannedStartDate)
                : undefined,
              plannedEndDate: dto.plannedEndDate
                ? new Date(dto.plannedEndDate)
                : undefined,
              status: 'planned',
            },
          ],
          { session },
        );
        created.push(doc);

        // Load active TechProcess and Bom
        const [techProcess, bom] = await Promise.all([
          this.techProcessModel
            .findOne({ productId: doc.productId, isActive: true })
            .sort({ createdAt: -1 })
            .exec(),
          this.bomModel
            .findOne({ productId: doc.productId, isActive: true })
            .sort({ createdAt: -1 })
            .exec(),
        ]);

        let prevTaskId: Types.ObjectId | undefined;
        let cumulativeStart: Date | undefined = doc.plannedStartDate
          ? new Date(doc.plannedStartDate)
          : undefined;

        // Create tasks from TechProcess operations
        if (techProcess && techProcess.operations.length > 0) {
          for (const op of techProcess.operations) {
            const task: Partial<OrderTask> = {
              productionOrderId: doc._id,
              workTypeId: op.workTypeId,
              workCenterId: op.workCenterId,
              title: `Operation seq=${op.sequence}`,
              estimatedHours: op.durationHours,
              plannedStartDate: cumulativeStart,
              dependsOnTaskIds: prevTaskId ? [prevTaskId] : [],
              sortOrder: op.sequence,
              status: 'pending',
            };
            if (cumulativeStart) {
              cumulativeStart = new Date(
                cumulativeStart.getTime() +
                  (op.durationHours ?? 0) * 60 * 60 * 1000,
              );
            }
            const [createdTask] = await this.orderTaskModel.create([task], { session });
            prevTaskId = createdTask._id as Types.ObjectId;
          }
        }

        // Create material tasks from Bom
        if (bom && bom.components.length > 0) {
          let componentSeq = 100;
          for (const comp of bom.components) {
            if (!comp.productComponentId) continue;
            const task: Partial<OrderTask> = {
              productionOrderId: doc._id,
              componentId: comp.productComponentId,
              title: `Material: ${comp.productComponentId.toString().slice(-6)}`,
              sortOrder: componentSeq++,
              status: 'pending',
            };
            await this.orderTaskModel.create([task], { session });
          }
        }
      });
    } finally {
      await session.endSession();
    }

    return created[0];
  }

  async findAll(): Promise<ProductionOrderDocument[]> {
    return this.model
      .find()
      .populate('productId')
      .populate('workTypeId')
      .populate('workCenterId')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findById(id: string): Promise<ProductionOrderDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ProductionOrder ${id} not found`);
    }
    const doc = await this.model
      .findById(id)
      .populate('productId')
      .populate('workTypeId')
      .populate('workCenterId')
      .populate('contractId')
      .populate('proposalId')
      .exec();
    if (!doc) throw new NotFoundException(`ProductionOrder ${id} not found`);
    return doc;
  }

  async update(
    id: string,
    dto: UpdateProductionOrderDto,
  ): Promise<ProductionOrderDocument> {
    const doc = await this.findById(id);
    const fields: (keyof UpdateProductionOrderDto)[] = [
      'title',
      'ralCode',
      'notes',
      'packageTag',
      'quantity',
    ];
    for (const f of fields) {
      if ((dto as Record<string, unknown>)[f] !== undefined) {
        (doc as unknown as Record<string, unknown>)[f] = (
          dto as Record<string, unknown>
        )[f];
      }
    }
    if (dto.workCenterId !== undefined) {
      doc.workCenterId = dto.workCenterId
        ? new Types.ObjectId(dto.workCenterId)
        : (undefined as unknown as Types.ObjectId);
    }
    if (dto.workTypeId !== undefined) {
      doc.workTypeId = dto.workTypeId
        ? new Types.ObjectId(dto.workTypeId)
        : (undefined as unknown as Types.ObjectId);
    }
    if (dto.plannedStartDate !== undefined) {
      doc.plannedStartDate = new Date(dto.plannedStartDate);
    }
    if (dto.plannedEndDate !== undefined) {
      doc.plannedEndDate = new Date(dto.plannedEndDate);
    }
    return doc.save();
  }

  async start(id: string): Promise<ProductionOrderDocument> {
    const doc = await this.findById(id);
    if (doc.status !== 'planned' && doc.status !== 'draft') {
      throw new BadRequestException(
        `Cannot start order in status ${doc.status}`,
      );
    }
    doc.status = 'in_progress';
    doc.actualStartDate = new Date();
    return doc.save();
  }

  async close(id: string): Promise<ProductionOrderDocument> {
    const doc = await this.findById(id);
    // Check all tasks completed
    const incomplete = await this.orderTaskModel
      .countDocuments({
        productionOrderId: doc._id,
        status: { $nin: ['completed', 'skipped'] },
      })
      .exec();
    if (incomplete > 0) {
      throw new BadRequestException(
        `Cannot close order with ${incomplete} incomplete tasks`,
      );
    }
    doc.status = 'closed';
    doc.actualEndDate = new Date();
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
