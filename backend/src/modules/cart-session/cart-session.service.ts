import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { CartSession, CartSessionDocument } from './cart-session.schema';
import { CreateCartSessionDto } from './dto/create-cart-session.dto';
import { QuotationService } from '../quotation/quotation.service';
import { CartItem, CartItemDocument } from '../cart-item/cart-item.schema';

@Injectable()
export class CartSessionService {
  constructor(
    @InjectModel(CartSession.name)
    private readonly model: Model<CartSessionDocument>,
    @InjectModel(CartItem.name)
    private readonly cartItemModel: Model<CartItemDocument>,
    private readonly quotationService: QuotationService,
  ) {}

  async create(dto: CreateCartSessionDto): Promise<CartSessionDocument> {
    const sessionId = randomUUID();
    return this.model.create({
      sessionId,
      counterpartyId: dto.counterpartyId ? new Types.ObjectId(dto.counterpartyId) : undefined,
      organizationId: dto.organizationId ? new Types.ObjectId(dto.organizationId) : undefined,
      userId: dto.userId ? new Types.ObjectId(dto.userId) : undefined,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      status: 'active',
    });
  }

  async findById(id: string): Promise<CartSessionDocument> {
    // Accept either Mongo _id or sessionId (UUID)
    if (Types.ObjectId.isValid(id)) {
      const doc = await this.model.findById(id).exec();
      if (doc) return doc;
    }
    const doc = await this.model.findOne({ sessionId: id }).exec();
    if (!doc) throw new NotFoundException(`CartSession ${id} not found`);
    return doc;
  }

  async findBySessionId(sessionId: string): Promise<CartSessionDocument> {
    const doc = await this.model.findOne({ sessionId }).exec();
    if (!doc) throw new NotFoundException(`CartSession ${sessionId} not found`);
    return doc;
  }

  async findItems(sessionId: string): Promise<CartItemDocument[]> {
    return this.cartItemModel
      .find({ sessionId, status: 'active' })
      .populate('productId')
      .sort({ createdAt: 1 })
      .exec();
  }

  async checkout(
    sessionId: string,
    organizationId: string,
    counterpartyId: string,
  ): Promise<{ session: CartSessionDocument; quotationId: string }> {
    const session = await this.findBySessionId(sessionId);
    if (session.status === 'converted') {
      throw new BadRequestException(`CartSession already converted`);
    }
    const items = await this.cartItemModel
      .find({ sessionId, status: 'active' })
      .exec();
    if (items.length === 0) {
      throw new BadRequestException(`Cart is empty`);
    }
    const quotation = await this.quotationService.create({
      organizationId,
      counterpartyId,
      status: 'draft',
      items: items.map((i) => ({
        productId: i.productId.toString(),
        productName: i.productName,
        quantity: i.quantity,
        unit: i.unit,
        unitPrice: i.priceSnapshot,
        markupPercent: i.markupPercent,
      })),
    });
    // Mark cart items as converted
    await this.cartItemModel.updateMany(
      { sessionId, status: 'active' },
      {
        $set: {
          status: 'converted',
          isConverted: true,
          convertedQuotationId: quotation._id.toString(),
        },
      },
    );
    session.status = 'converted';
    session.convertedQuotationId = quotation._id.toString();
    await session.save();
    return { session, quotationId: quotation._id.toString() };
  }
}
