import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { OrganizationContact, OrganizationContactDocument } from './organization-contact.schema';

@Injectable()
export class OrganizationContactService {
  private readonly logger = new Logger(OrganizationContactService.name);

  constructor(
    @InjectModel(OrganizationContact.name)
    private readonly model: Model<OrganizationContactDocument>,
  ) {}

  async add(
    organizationId: string,
    personId: string,
    data: { isPrimary?: boolean; role?: string } = {},
  ): Promise<OrganizationContactDocument> {
    return this.model.create({
      organizationId: new Types.ObjectId(organizationId),
      personId: new Types.ObjectId(personId),
      isPrimary: data.isPrimary ?? false,
      role: data.role,
    });
  }

  async list(organizationId: string): Promise<OrganizationContactDocument[]> {
    return this.model
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .populate('personId')
      .sort({ isPrimary: -1, createdAt: 1 })
      .exec();
  }

  async remove(organizationId: string, personId: string): Promise<void> {
    const res = await this.model
      .deleteOne({
        organizationId: new Types.ObjectId(organizationId),
        personId: new Types.ObjectId(personId),
      })
      .exec();
    if (res.deletedCount === 0) {
      throw new NotFoundException(`Contact ${personId} not found for organization ${organizationId}`);
    }
  }
}
