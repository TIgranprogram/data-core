import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WorkCenter, WorkCenterDocument } from './work-center.schema';
import { CreateWorkCenterDto } from './dto/create-work-center.dto';
import { UpdateWorkCenterDto } from './dto/update-work-center.dto';

@Injectable()
export class WorkCenterService {
  constructor(
    @InjectModel(WorkCenter.name)
    private readonly model: Model<WorkCenterDocument>,
  ) {}

  async create(dto: CreateWorkCenterDto): Promise<WorkCenterDocument> {
    return this.model.create({
      ...dto,
      type: dto.type ?? 'machine',
      capacity: dto.capacity ?? 1,
      isActive: dto.isActive ?? true,
    });
  }

  async findAll(): Promise<WorkCenterDocument[]> {
    return this.model.find().sort({ name: 1 }).exec();
  }

  async findById(id: string): Promise<WorkCenterDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`WorkCenter ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`WorkCenter ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateWorkCenterDto): Promise<WorkCenterDocument> {
    const doc = await this.findById(id);
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.type !== undefined) doc.type = dto.type;
    if (dto.description !== undefined) doc.description = dto.description;
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    if (dto.capacity !== undefined) doc.capacity = dto.capacity;
    if (dto.location !== undefined) doc.location = dto.location;
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
