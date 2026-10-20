import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { Unit, UnitDocument } from './unit.schema';

@Injectable()
export class UnitService {
  private readonly logger = new Logger(UnitService.name);

  constructor(
    @InjectModel(Unit.name) private readonly model: Model<UnitDocument>,
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

  /** Compact sorted list for dropdowns (form selects). */
  async findActive(): Promise<UnitDocument[]> {
    return this.model
      .find({ isActive: true })
      .sort({ sortOrder: 1, key: 1 })
      .exec();
  }

  async findByKey(key: string): Promise<UnitDocument> {
    const doc = await this.model.findOne({ key }).exec();
    if (!doc) throw new NotFoundException(`Unit "${key}" not found`);
    return doc;
  }

  async create(dto: CreateUnitDto): Promise<UnitDocument> {
    const exists = await this.model.findOne({ key: dto.key }).exec();
    if (exists) {
      throw new BadRequestException(`Unit "${dto.key}" already exists`);
    }
    const doc = await this.model.create({
      ...dto,
      isActive: dto.isActive ?? true,
      isSystem: dto.isSystem ?? false,
      sortOrder: dto.sortOrder ?? 0,
    });
    this.logger.log(`Unit created: ${doc.key}`);
    return doc;
  }

  async update(key: string, dto: UpdateUnitDto): Promise<UnitDocument> {
    const doc = await this.findByKey(key);
    Object.assign(doc, dto);
    return doc.save();
  }

  async remove(key: string): Promise<void> {
    const doc = await this.findByKey(key);
    if (doc.isSystem) {
      throw new BadRequestException(
        `System unit "${key}" cannot be deleted — deactivate it instead`,
      );
    }
    // Schema has no `deletedAt` and opts out of the soft-delete plugin
    // (`softDelete: false`) — a soft-delete `$set` was a silent no-op
    // (Mongoose strict strips the unknown path), leaving the row behind
    // and blocking the unique `key` index. Hard delete matches the
    // collection (same fix as storage-item.service.ts for the same bug).
    await this.model.deleteOne({ _id: doc._id }).exec();
    this.logger.log(`Unit deleted: ${key}`);
  }
}
