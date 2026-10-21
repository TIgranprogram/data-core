import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RoleOrg, RoleOrgDocument } from './role-org.schema';

export interface UpsertRoleOrgDto {
  name: string;
  slug: string;
  description?: string;
  isActive?: boolean;
  isSystem?: boolean;
}

@Injectable()
export class RoleOrgService {
  constructor(
    @InjectModel(RoleOrg.name) private readonly model: Model<RoleOrgDocument>,
  ) {}

  async findAll(): Promise<RoleOrgDocument[]> {
    return this.model.find().sort({ name: 1 }).exec();
  }

  async findById(id: string): Promise<RoleOrgDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`OrgRole ${id} not found`);
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`OrgRole ${id} not found`);
    return doc;
  }

  async findBySlug(slug: string): Promise<RoleOrgDocument | null> {
    return this.model.findOne({ slug }).exec();
  }

  async upsert(dto: UpsertRoleOrgDto): Promise<RoleOrgDocument> {
    const doc = await this.model
      .findOneAndUpdate({ slug: dto.slug }, { $set: dto }, { new: true, upsert: true, setDefaultsOnInsert: true })
      .exec();
    return doc as RoleOrgDocument;
  }

  async create(dto: UpsertRoleOrgDto): Promise<RoleOrgDocument> {
    const exists = await this.model.findOne({ slug: dto.slug }).exec();
    if (exists) throw new ConflictException(`OrgRole "${dto.slug}" already exists`);
    return this.model.create(dto);
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    if (doc.isSystem) throw new ConflictException(`System OrgRole "${doc.slug}" cannot be deleted`);
    await doc.deleteOne();
  }
}
