import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateCurrencyDto } from './dto/create-currency.dto';
import { UpdateCurrencyDto } from './dto/update-currency.dto';
import { Currency, CurrencyDocument } from './currency.schema';

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);

  constructor(
    @InjectModel(Currency.name) private readonly model: Model<CurrencyDocument>,
  ) {}

  async findAll(q: {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  } = {}) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(100, Math.max(1, q.limit ?? 20));
    const filter: Record<string, unknown> = {};
    if (q.search) {
      // Escape user input to prevent ReDoS / regex injection
      const escaped = q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'i');
      filter.$or = [{ key: re }, { label: re }, { symbol: re }];
    }
    if (q.isActive !== undefined) filter.isActive = q.isActive;
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ sortOrder: 1, key: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit };
  }

  async findActive(): Promise<CurrencyDocument[]> {
    return this.model
      .find({ isActive: true })
      .sort({ sortOrder: 1, key: 1 })
      .exec();
  }

  async findByKey(key: string): Promise<CurrencyDocument> {
    const doc = await this.model.findOne({ key }).exec();
    if (!doc) throw new NotFoundException(`Currency "${key}" not found`);
    return doc;
  }

  async create(dto: CreateCurrencyDto): Promise<CurrencyDocument> {
    const exists = await this.model.findOne({ key: dto.key }).exec();
    if (exists) {
      throw new BadRequestException(`Currency "${dto.key}" already exists`);
    }
    const doc = await this.model.create({
      ...dto,
      isActive: dto.isActive ?? true,
      isSystem: dto.isSystem ?? false,
      sortOrder: dto.sortOrder ?? 0,
      rate: dto.rate ?? 1.0,
      isBase: dto.isBase ?? false,
      locale: dto.locale ?? 'ru-RU',
      precision: dto.precision ?? 2,
    });
    this.logger.log(`Currency created: ${doc.key}`);
    return doc;
  }

  async update(key: string, dto: UpdateCurrencyDto): Promise<CurrencyDocument> {
    const doc = await this.findByKey(key);
    Object.assign(doc, dto);
    return doc.save();
  }

  async remove(key: string): Promise<void> {
    const doc = await this.findByKey(key);
    if (doc.isSystem) {
      throw new BadRequestException(
        `System currency "${key}" cannot be deleted — deactivate it instead`,
      );
    }
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
    this.logger.log(`Currency soft-deleted: ${key}`);
  }
}
