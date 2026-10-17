import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CartItem, CartItemDocument } from './cart-item.schema';
import { CreateCartItemDto } from './dto/create-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { Product, ProductDocument } from '../product/product.schema';

@Injectable()
export class CartItemService {
  constructor(
    @InjectModel(CartItem.name)
    private readonly model: Model<CartItemDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  async create(dto: CreateCartItemDto): Promise<CartItemDocument> {
    if (!Types.ObjectId.isValid(dto.productId)) {
      throw new NotFoundException(`Product ${dto.productId} not found`);
    }
    const product = await this.productModel.findById(dto.productId).exec();
    if (!product) {
      throw new NotFoundException(`Product ${dto.productId} not found`);
    }
    const priceSnapshot = product.listPrice ?? product.basePrice ?? 0;
    return this.model.create({
      sessionId: dto.sessionId,
      productId: new Types.ObjectId(dto.productId),
      productName: product.name,
      quantity: dto.quantity,
      unit: dto.unit ?? product.unit,
      priceSnapshot,
      markupPercent: dto.markupPercent ?? 0,
      notes: dto.notes,
      status: 'active',
    });
  }

  async findAll(sessionId?: string): Promise<CartItemDocument[]> {
    const filter: Record<string, unknown> = {};
    if (sessionId) filter.sessionId = sessionId;
    return this.model
      .find(filter)
      .populate('productId')
      .sort({ createdAt: 1 })
      .exec();
  }

  async findById(id: string): Promise<CartItemDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`CartItem ${id} not found`);
    }
    const doc = await this.model.findById(id).populate('productId').exec();
    if (!doc) throw new NotFoundException(`CartItem ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateCartItemDto): Promise<CartItemDocument> {
    const doc = await this.findById(id);
    if (dto.quantity !== undefined) doc.quantity = dto.quantity;
    if (dto.markupPercent !== undefined) doc.markupPercent = dto.markupPercent;
    if (dto.notes !== undefined) doc.notes = dto.notes;
    return doc.save();
  }

  async remove(id: string): Promise<CartItemDocument> {
    const doc = await this.findById(id);
    doc.status = 'removed';
    doc.isConverted = false;
    return doc.save();
  }
}
