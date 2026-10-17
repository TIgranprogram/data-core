import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WorkType, WorkTypeDocument } from './work-type.schema';
import { CreateWorkTypeDto } from './dto/create-work-type.dto';
import { UpdateWorkTypeDto } from './dto/update-work-type.dto';

@Injectable()
export class WorkTypeService implements OnModuleInit {
  private readonly logger = new Logger(WorkTypeService.name);

  constructor(@InjectModel(WorkType.name) private readonly model: Model<WorkTypeDocument>) {}

  /** TZ-COST-301 — idempotent: missing/null hourlyRate → 0. */
  async onModuleInit(): Promise<void> {
    const res = await this.model
      .updateMany(
        { $or: [{ hourlyRate: { $exists: false } }, { hourlyRate: null }] },
        { $set: { hourlyRate: 0 } },
      )
      .exec();
    if (res.modifiedCount > 0) {
      this.logger.log(`TZ-COST-301 backfill hourlyRate=0 for ${res.modifiedCount} work type(s)`);
    }
  }

  async create(dto: CreateWorkTypeDto): Promise<WorkTypeDocument> {
    return this.model.create({ ...dto, workCenterId: dto.workCenterId ? new Types.ObjectId(dto.workCenterId) : undefined });
  }

  async findAll(workCenterId?: string): Promise<WorkTypeDocument[]> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (workCenterId) { if (!Types.ObjectId.isValid(workCenterId)) return []; filter.workCenterId = new Types.ObjectId(workCenterId); }
    return this.model.find(filter).sort({ name: 1 }).exec();
  }

  async findById(id: string): Promise<WorkTypeDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`WorkType ${id} not found`);
    const doc = typeof (this.model as unknown as { findOne?: unknown }).findOne === 'function'
      ? await (this.model as unknown as { findOne: (filter: Record<string, unknown>) => { exec: () => Promise<WorkTypeDocument | null> } }).findOne({ _id: new Types.ObjectId(id), deletedAt: null }).exec()
      : await this.model.findById(id).exec();
    if (!doc || doc.deletedAt) throw new NotFoundException(`WorkType ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateWorkTypeDto): Promise<WorkTypeDocument> {
    const doc = await this.findById(id);
    if (dto.name !== undefined) doc.name = dto.name; if (dto.section !== undefined) doc.section = dto.section; if (dto.description !== undefined) doc.description = dto.description; if (dto.isActive !== undefined) doc.isActive = dto.isActive; if (dto.department !== undefined) doc.department = dto.department; if (dto.defaultDurationHours !== undefined) doc.defaultDurationHours = dto.defaultDurationHours; if (dto.hourlyRate !== undefined) doc.hourlyRate = dto.hourlyRate; if (dto.days !== undefined) doc.days = dto.days; if (dto.accentHue !== undefined) doc.accentHue = dto.accentHue; if (dto.workCenterId !== undefined) doc.workCenterId = dto.workCenterId ? new Types.ObjectId(dto.workCenterId) : (undefined as unknown as Types.ObjectId);
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    const refs = await Promise.all([this.model.db.collection('costcalculations').findOne({ 'labor.workTypeId': doc._id }), this.model.db.collection('productmodules').findOne({ 'workTypes.workTypeId': doc._id }), this.model.db.collection('workers').findOne({ workTypeIds: doc._id })]);
    if (refs.some(Boolean)) throw new ConflictException('WorkType is referenced by catalog history and cannot be archived');
    await this.model.updateOne({ _id: doc._id, deletedAt: null }, { $set: { deletedAt: new Date(), isActive: false } }).exec();
  }
}
