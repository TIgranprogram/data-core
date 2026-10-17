import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RoutingStep, RoutingStepDocument } from './routing-step.schema';
import { CreateRoutingStepDto } from './dto/create-routing-step.dto';
import { UpdateRoutingStepDto } from './dto/update-routing-step.dto';

@Injectable()
export class RoutingStepService {
  constructor(
    @InjectModel(RoutingStep.name)
    private readonly model: Model<RoutingStepDocument>,
  ) {}

  async create(dto: CreateRoutingStepDto): Promise<RoutingStepDocument> {
    return this.model.create({
      ...dto,
      workTypeId: dto.workTypeId ? new Types.ObjectId(dto.workTypeId) : undefined,
    });
  }

  async findAll(
    workshop?: string,
    workTypeId?: string,
    isActive?: boolean,
  ): Promise<RoutingStepDocument[]> {
    const filter: Record<string, unknown> = {};
    if (workshop) filter.workshop = workshop;
    if (typeof isActive === 'boolean') filter.isActive = isActive;
    if (workTypeId) {
      if (!Types.ObjectId.isValid(workTypeId)) return [];
      filter.workTypeId = new Types.ObjectId(workTypeId);
    }
    return this.model.find(filter).sort({ workshop: 1, number: 1 }).exec();
  }

  async findById(id: string): Promise<RoutingStepDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`RoutingStep ${id} not found`);
    }
    const doc = await this.model.findById(id).populate('workTypeId').exec();
    if (!doc) throw new NotFoundException(`RoutingStep ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateRoutingStepDto): Promise<RoutingStepDocument> {
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`RoutingStep ${id} not found`);
    if (dto.number !== undefined) doc.number = dto.number;
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.workshop !== undefined) doc.workshop = dto.workshop;
    if (dto.duration !== undefined) doc.duration = dto.duration;
    if (dto.costPerHour !== undefined) doc.costPerHour = dto.costPerHour;
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    if (dto.workTypeId !== undefined) {
      doc.workTypeId = dto.workTypeId ? new Types.ObjectId(dto.workTypeId) : (undefined as unknown as Types.ObjectId);
    }
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`RoutingStep ${id} not found`);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
