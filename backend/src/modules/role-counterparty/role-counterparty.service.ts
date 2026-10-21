import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RoleCounterparty, RoleCounterpartyDocument } from './role-counterparty.schema';

export interface UpsertRoleCounterpartyDto {
  name: string;
  slug: string;
  description?: string;
  isActive?: boolean;
  isSystem?: boolean;
}

@Injectable()
export class RoleCounterpartyService {
  constructor(
    @InjectModel(RoleCounterparty.name) private readonly model: Model<RoleCounterpartyDocument>,
  ) {}

  async findAll(): Promise<RoleCounterpartyDocument[]> {
    return this.model.find().sort({ name: 1 }).exec();
  }

  async findById(id: string): Promise<RoleCounterpartyDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`CounterpartyRole ${id} not found`);
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`CounterpartyRole ${id} not found`);
    return doc;
  }

  async findBySlug(slug: string): Promise<RoleCounterpartyDocument | null> {
    return this.model.findOne({ slug }).exec();
  }

  async create(dto: UpsertRoleCounterpartyDto): Promise<RoleCounterpartyDocument> {
    const exists = await this.model.findOne({ slug: dto.slug }).exec();
    if (exists) throw new ConflictException(`CounterpartyRole "${dto.slug}" already exists`);
    return this.model.create(dto);
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    if (doc.isSystem) throw new ConflictException(`System CounterpartyRole "${doc.slug}" cannot be deleted`);
    await doc.deleteOne();
  }
}
