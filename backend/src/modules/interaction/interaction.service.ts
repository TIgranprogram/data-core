import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateInteractionDto } from './dto/create-interaction.dto';
import { UpdateInteractionDto } from './dto/update-interaction.dto';
import { Interaction, InteractionDocument } from './interaction.schema';

@Injectable()
export class InteractionService {
  private readonly logger = new Logger(InteractionService.name);

  constructor(
    @InjectModel(Interaction.name) private readonly model: Model<InteractionDocument>,
  ) {}

  async create(dto: CreateInteractionDto): Promise<InteractionDocument> {
    return this.model.create({
      ...dto,
      counterpartyId: new Types.ObjectId(dto.counterpartyId),
      relatedToId: dto.relatedToId ? new Types.ObjectId(dto.relatedToId) : undefined,
      occurredAt: dto.occurredAt ?? new Date(),
    });
  }

  async findAll(q: { counterpartyId?: string; type?: string; page?: number; limit?: number } = {}) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(100, Math.max(1, q.limit ?? 20));
    const filter: Record<string, unknown> = {};
    if (q.counterpartyId) filter.counterpartyId = new Types.ObjectId(q.counterpartyId);
    if (q.type) filter.type = q.type;
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('counterpartyId', 'name shortName inn')
        .sort({ occurredAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit };
  }

  async findById(id: string): Promise<InteractionDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Interaction ${id} not found`);
    const doc = await this.model.findById(id).populate('counterpartyId').exec();
    if (!doc) throw new NotFoundException(`Interaction ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateInteractionDto): Promise<InteractionDocument> {
    const doc = await this.findById(id);
    Object.assign(doc, dto);
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
