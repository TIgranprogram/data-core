import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Material, MaterialDocument } from '../material/material.schema';
import { Product, ProductDocument } from '../product/product.schema';
import { ProductModule, ProductModuleDocument } from '../product-module/product-module.schema';
import { CreateAttachmentDto, UpdateAttachmentDto } from './attachment.dto';
import { Attachment, AttachmentDocument, ATTACHMENT_ENTITY_TYPES } from './attachment.schema';

type ParentDocument = ProductDocument | ProductModuleDocument | MaterialDocument;
type OrgScopedUser = Pick<AuthenticatedUser, 'organizationId'>;

@Injectable()
export class AttachmentService {
  constructor(
    @InjectModel(Attachment.name) private readonly model: Model<AttachmentDocument>,
    @InjectModel(Product.name) private readonly productModel: Model<ProductDocument>,
    @InjectModel(ProductModule.name) private readonly moduleModel: Model<ProductModuleDocument>,
    @InjectModel(Material.name) private readonly materialModel: Model<MaterialDocument>,
  ) {}

  async list(entityType: CreateAttachmentDto['entityType'], entityId: string, user?: OrgScopedUser): Promise<AttachmentDocument[]> {
    this.assertEntityType(entityType);
    const parent = await this.assertParentAccess(entityType, entityId, user);
    const filter: Record<string, unknown> = {
      entityType,
      entityId: new Types.ObjectId(entityId),
      isActive: true,
    };
    const parentOrganizationId = this.parentOrganizationId(parent);
    if (parentOrganizationId) filter.organizationId = parentOrganizationId;
    else if (user?.organizationId) filter.organizationId = this.organizationScope(user);
    return this.model.find(filter).sort({ createdAt: -1, _id: 1 }).exec();
  }

  async create(dto: CreateAttachmentDto, user?: OrgScopedUser): Promise<AttachmentDocument> {
    this.assertEntityType(dto.entityType);
    const parent = await this.assertParentAccess(dto.entityType, dto.entityId, user);
    const parentOrganizationId = this.parentOrganizationId(parent);
    const requestedOrganizationId = this.parseOptionalObjectId(dto.organizationId, true);
    if (requestedOrganizationId && parentOrganizationId && !requestedOrganizationId.equals(parentOrganizationId)) {
      throw new NotFoundException('Attachment parent not found');
    }
    if (requestedOrganizationId && user?.organizationId && requestedOrganizationId.toString() !== user.organizationId) {
      throw new NotFoundException('Attachment parent not found');
    }
    return this.model.create({
      ...dto,
      entityId: new Types.ObjectId(dto.entityId),
      organizationId: parentOrganizationId ?? requestedOrganizationId ?? undefined,
    });
  }

  async update(id: string, dto: UpdateAttachmentDto, user?: OrgScopedUser): Promise<AttachmentDocument> {
    const attachment = await this.findAccessible(id, user);
    const nextEntityType = dto.entityType ?? attachment.entityType;
    const nextEntityId = dto.entityId ?? attachment.entityId.toString();
    const parent = await this.assertParentAccess(nextEntityType, nextEntityId, user);
    const parentOrganizationId = this.parentOrganizationId(parent);
    const requestedOrganizationId = this.parseOptionalObjectId(dto.organizationId, true);
    if (requestedOrganizationId && parentOrganizationId && !requestedOrganizationId.equals(parentOrganizationId)) {
      throw new NotFoundException('Attachment not found');
    }
    Object.assign(attachment, dto, {
      entityId: new Types.ObjectId(nextEntityId),
      organizationId: parentOrganizationId ?? requestedOrganizationId ?? attachment.organizationId,
    });
    return attachment.save();
  }

  async remove(id: string, user?: OrgScopedUser): Promise<void> {
    const attachment = await this.findAccessible(id, user);
    await this.assertParentAccess(attachment.entityType, attachment.entityId.toString(), user);
    attachment.isActive = false;
    await attachment.save();
  }

  private async findAccessible(id: string, user?: OrgScopedUser): Promise<AttachmentDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`Attachment ${id} not found`);
    const filter: Record<string, unknown> = { _id: new Types.ObjectId(id), isActive: true };
    if (user?.organizationId) filter.organizationId = this.organizationScope(user);
    const attachment = await this.model.findOne(filter).exec();
    if (!attachment) throw new NotFoundException(`Attachment ${id} not found`);
    return attachment;
  }

  private async assertParentAccess(entityType: CreateAttachmentDto['entityType'], entityId: string, user?: OrgScopedUser): Promise<ParentDocument> {
    this.assertEntityType(entityType);
    if (!Types.ObjectId.isValid(entityId)) throw new NotFoundException('Attachment parent not found');
    const id = new Types.ObjectId(entityId);
    const parent = entityType === 'Product'
      ? await this.productModel.findById(id).select('organizationId').exec()
      : entityType === 'ProductModule'
        ? await this.moduleModel.findById(id).select('_id').exec()
        : await this.materialModel.findById(id).select('organizationId').exec();
    if (!parent) throw new NotFoundException('Attachment parent not found');
    const parentOrganizationId = this.parentOrganizationId(parent);
    if (parentOrganizationId && user?.organizationId && !parentOrganizationId.equals(this.parseUserOrganization(user))) {
      throw new NotFoundException('Attachment parent not found');
    }
    return parent;
  }

  private assertEntityType(value: string): asserts value is CreateAttachmentDto['entityType'] {
    if (!ATTACHMENT_ENTITY_TYPES.includes(value as CreateAttachmentDto['entityType'])) {
      throw new BadRequestException('Unsupported attachment entity type');
    }
  }

  private parentOrganizationId(parent: ParentDocument): Types.ObjectId | undefined {
    const organizationId = (parent as ProductDocument | MaterialDocument).organizationId;
    if (!organizationId) return undefined;
    return organizationId instanceof Types.ObjectId ? organizationId : new Types.ObjectId(String(organizationId));
  }

  private parseUserOrganization(user?: OrgScopedUser): Types.ObjectId | undefined {
    if (!user?.organizationId) return undefined;
    return this.parseOptionalObjectId(user.organizationId, true);
  }

  private organizationScope(user: OrgScopedUser): { $in: (Types.ObjectId | null)[] } {
    const organizationId = this.parseUserOrganization(user);
    return { $in: organizationId ? [organizationId, null] : [null] };
  }

  private parseOptionalObjectId(value?: string, required = false): Types.ObjectId | undefined {
    if (!value) return undefined;
    if (!Types.ObjectId.isValid(value)) {
      if (required) throw new BadRequestException('Invalid organizationId');
      return undefined;
    }
    return new Types.ObjectId(value);
  }
}
