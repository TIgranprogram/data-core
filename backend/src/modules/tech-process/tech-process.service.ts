import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TechProcess, TechProcessDocument } from './tech-process.schema';
import { CreateTechProcessDto } from './dto/create-tech-process.dto';
import { UpdateTechProcessDto } from './dto/update-tech-process.dto';

@Injectable()
export class TechProcessService {
  constructor(
    @InjectModel(TechProcess.name)
    private readonly model: Model<TechProcessDocument>,
  ) {}

  async create(dto: CreateTechProcessDto): Promise<TechProcessDocument> {
    const operations = (dto.operations ?? []).map((op) => ({
      sequence: op.sequence,
      workTypeId: new Types.ObjectId(op.workTypeId),
      durationHours: op.durationHours,
      workCenterId: new Types.ObjectId(op.workCenterId),
    }));
    const totalDuration = this.calcTotal(operations.map((o) => o.durationHours));
    return this.model.create({
      productId: new Types.ObjectId(dto.productId),
      operations,
      totalDuration,
      isActive: dto.isActive ?? false,
    });
  }

  async findByProductId(productId: string): Promise<TechProcessDocument[]> {
    if (!Types.ObjectId.isValid(productId)) return [];
    return this.model
      .find({ productId: new Types.ObjectId(productId) })
      .sort({ isActive: -1, createdAt: -1 })
      .exec();
  }

  async findAll(): Promise<TechProcessDocument[]> {
    return this.model.find().sort({ productId: 1, createdAt: -1 }).exec();
  }

  async findById(id: string, expand = false): Promise<TechProcessDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`TechProcess ${id} not found`);
    }
    const q = this.model.findById(id);
    if (expand) {
      q.populate('operations.workTypeId').populate('operations.workCenterId');
    }
    const doc = await q.exec();
    if (!doc) throw new NotFoundException(`TechProcess ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateTechProcessDto): Promise<TechProcessDocument> {
    const doc = await this.findById(id);
    if (dto.operations !== undefined) {
      doc.operations = dto.operations.map((op) => ({
        sequence: op.sequence,
        workTypeId: new Types.ObjectId(op.workTypeId),
        durationHours: op.durationHours,
        workCenterId: new Types.ObjectId(op.workCenterId),
      }));
      doc.totalDuration = this.calcTotal(doc.operations.map((o) => o.durationHours));
    }
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    return doc.save();
  }

  async activate(id: string): Promise<TechProcessDocument> {
    const doc = await this.findById(id);
    if (doc.operations.length === 0) {
      throw new BadRequestException('Cannot activate tech process with no operations');
    }
    // Deactivate other active tech processes for same product
    await this.model
      .updateMany(
        { productId: doc.productId, _id: { $ne: doc._id }, isActive: true },
        { $set: { isActive: false } },
      )
      .exec();
    doc.isActive = true;
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }

  private calcTotal(durations: number[]): number {
    return durations.reduce((sum, d) => sum + (Number.isFinite(d) ? d : 0), 0);
  }
}
