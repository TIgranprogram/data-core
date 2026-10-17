import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role, RoleDocument } from './role.schema';
import { userActivityCache } from '../../common/guards/user-activity-cache';

@Injectable()
export class RoleService {
  private readonly logger = new Logger(RoleService.name);

  constructor(
    @InjectModel(Role.name) private readonly model: Model<RoleDocument>,
  ) {}

  async create(dto: CreateRoleDto): Promise<RoleDocument> {
    const existing = await this.model.findOne({ name: dto.name }).exec();
    if (existing) {
      throw new ConflictException(`Role "${dto.name}" already exists`);
    }
    const doc = await this.model.create({
      ...dto,
      sortOrder: dto.sortOrder ?? 100,
      isActive: dto.isActive ?? true,
    });
    this.logger.log(`Role created: ${doc.name}`);
    return doc;
  }

  async findAll(): Promise<RoleDocument[]> {
    return this.model.find().sort({ sortOrder: 1, name: 1 }).exec();
  }

  async findById(id: string): Promise<RoleDocument> {
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`Role ${id} not found`);
    return doc;
  }

  async findByName(name: string): Promise<RoleDocument | null> {
    return this.model.findOne({ name }).exec();
  }

  async update(id: string, dto: UpdateRoleDto): Promise<RoleDocument> {
    const doc = await this.findById(id);
    const oldRoleName = doc.name;
    Object.assign(doc, dto);
    await doc.save();
    if (oldRoleName !== doc.name) {
      this.model
        .updateMany({ role: oldRoleName }, { role: doc.name })
        .exec();
    }
    userActivityCache.invalidateAll();
    this.logger.log(`Role updated: ${doc.name}`);
    return doc;
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    if (doc.isSystem) {
      throw new ConflictException(
        `System role "${doc.name}" cannot be deleted`,
      );
    }
    await doc.deleteOne();
    this.logger.log(`Role deleted: ${doc.name}`);
  }
}
