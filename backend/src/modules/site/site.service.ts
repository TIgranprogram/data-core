import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateSiteDto, UpdateSiteDto } from './dto/create-site.dto';
import { Site, SiteDocument } from './site.schema';

@Injectable()
export class SiteService {
  constructor(@InjectModel(Site.name) private readonly model: Model<SiteDocument>) {}

  async create(dto: CreateSiteDto): Promise<SiteDocument> {
    if (!Types.ObjectId.isValid(dto.counterpartyId)) {
      throw new BadRequestException('Invalid counterpartyId');
    }
    return this.model.create({
      counterpartyId: new Types.ObjectId(dto.counterpartyId),
      name: dto.name.trim(),
      address: dto.address.trim(),
      isActive: true,
    });
  }

  async findByCounterparty(counterpartyId: string): Promise<SiteDocument[]> {
    if (!Types.ObjectId.isValid(counterpartyId)) return [];
    return this.model
      .find({
        counterpartyId: new Types.ObjectId(counterpartyId),
        deletedAt: null,
        isActive: true,
      })
      .sort({ name: 1 })
      .exec();
  }

  async findById(id: string): Promise<SiteDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Site ${id} not found`);
    const doc = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!doc) throw new NotFoundException(`Site ${id} not found`);
    return doc;
  }

  /** Ensure site belongs to counterparty; throw if not. */
  async assertBelongsTo(siteId: string, counterpartyId: string): Promise<SiteDocument> {
    const site = await this.findById(siteId);
    if (site.counterpartyId.toString() !== counterpartyId) {
      throw new BadRequestException('Site does not belong to the selected counterparty');
    }
    return site;
  }

  /**
   * Convert КП→заказ: reuse first active site or create «Объект по умолчанию».
   */
  async ensureDefaultForCounterparty(
    counterpartyId: string,
    addressFallback?: string,
  ): Promise<SiteDocument> {
    const existing = await this.findByCounterparty(counterpartyId);
    if (existing.length > 0) return existing[0]!;
    return this.create({
      counterpartyId,
      name: 'Объект по умолчанию',
      address: (addressFallback ?? '').trim() || 'Адрес не указан',
    });
  }

  async update(id: string, dto: UpdateSiteDto): Promise<SiteDocument> {
    const doc = await this.findById(id);
    if (dto.name !== undefined) doc.name = dto.name.trim();
    if (dto.address !== undefined) doc.address = dto.address.trim();
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } }).exec();
  }
}
