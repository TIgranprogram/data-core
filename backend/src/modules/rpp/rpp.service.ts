import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Rpp, RppDocument } from './rpp.schema';
import { CreateRppDto } from './dto/create-rpp.dto';
import { UpdateRppDto } from './dto/update-rpp.dto';

@Injectable()
export class RppService {
  constructor(
    @InjectModel(Rpp.name)
    private readonly model: Model<RppDocument>,
  ) {}

  async create(dto: CreateRppDto): Promise<RppDocument> {
    return this.model.create({
      ...dto,
      productId: new Types.ObjectId(dto.productId),
      submissionDate: dto.submissionDate ? new Date(dto.submissionDate) : undefined,
      registrationDate: dto.registrationDate ? new Date(dto.registrationDate) : undefined,
      expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
      status: dto.status ?? 'draft',
    });
  }

  async findAll(): Promise<RppDocument[]> {
    return this.model.find().populate('productId').sort({ expiryDate: 1 }).exec();
  }

  async findExpiring(days = 30): Promise<RppDocument[]> {
    const now = new Date();
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return this.model
      .find({
        expiryDate: { $gte: now, $lte: until },
        status: { $in: ['active', 'registered'] },
      })
      .populate('productId')
      .sort({ expiryDate: 1 })
      .exec();
  }

  async findById(id: string): Promise<RppDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Rpp ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`Rpp ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateRppDto): Promise<RppDocument> {
    const doc = await this.findById(id);
    if (dto.title !== undefined) doc.title = dto.title;
    if (dto.registryNumber !== undefined) doc.registryNumber = dto.registryNumber;
    if (dto.status !== undefined) doc.status = dto.status;
    if (dto.submissionDate !== undefined) doc.submissionDate = new Date(dto.submissionDate);
    if (dto.registrationDate !== undefined) doc.registrationDate = new Date(dto.registrationDate);
    if (dto.expiryDate !== undefined) doc.expiryDate = new Date(dto.expiryDate);
    if (dto.notes !== undefined) doc.notes = dto.notes;
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
