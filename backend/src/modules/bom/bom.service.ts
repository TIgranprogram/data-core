import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Bom, BomDocument } from './bom.schema';

export interface CreateBomDto {
  productId: string;
  version: string;
  isActive?: boolean;
  components: { productComponentId: string; quantity?: number; notes?: string }[];
  effectiveFrom?: Date;
  effectiveTo?: Date;
  notes?: string;
}

@Injectable()
export class BomService {
  private readonly logger = new Logger(BomService.name);

  constructor(
    @InjectModel(Bom.name) private readonly model: Model<BomDocument>,
  ) {}

  async create(dto: CreateBomDto): Promise<BomDocument> {
    const isActive = dto.isActive ?? false;
    if (isActive) {
      await this.model.updateMany(
        { productId: new Types.ObjectId(dto.productId) },
        { $set: { isActive: false } },
      ).exec();
    }
    return this.model.create({
      ...dto,
      productId: new Types.ObjectId(dto.productId),
      components: dto.components.map((c) => ({
        productComponentId: new Types.ObjectId(c.productComponentId),
        quantity: c.quantity ?? 1,
        notes: c.notes,
      })),
    });
  }

  async findByProduct(productId: string): Promise<BomDocument[]> {
    return this.model.find({ productId: new Types.ObjectId(productId) }).sort({ createdAt: -1 }).exec();
  }

  async findById(id: string): Promise<BomDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Bom ${id} not found`);
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`Bom ${id} not found`);
    return doc;
  }

  async activate(id: string): Promise<BomDocument> {
    const doc = await this.findById(id);
    await this.model.updateMany(
      { productId: doc.productId, _id: { $ne: doc._id } },
      { $set: { isActive: false } },
    ).exec();
    doc.isActive = true;
    return doc.save();
  }

  /**
   * Returns the full BOM tree with component + material details
   * (for costing / reporting). Uses Mongoose populate.
   */
  async getExpanded(id: string): Promise<unknown> {
    const doc = await this.model.findById(id)
      .populate({
        path: 'components.productComponentId',
        populate: [
          { path: 'material' },
          { path: 'workTypeId' },
        ],
      })
      .exec();
    if (!doc) throw new NotFoundException(`Bom ${id} not found`);

    const totalCost = doc.components.reduce((acc, c) => {
      const pc = c.productComponentId as unknown as {
        material?: { pricePerUnit?: number };
        quantityPerProduct?: number;
      } | null;
      const materialPrice = pc?.material?.pricePerUnit ?? 0;
      const qty = pc?.quantityPerProduct ?? 1;
      return acc + materialPrice * qty * c.quantity;
    }, 0);

    return {
      ...doc.toObject(),
      expanded: true,
      estimatedTotalCost: totalCost,
    };
  }
}
