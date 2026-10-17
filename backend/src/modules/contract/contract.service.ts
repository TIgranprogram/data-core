import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import { Model, Types } from 'mongoose';
import {
  Contract,
  ContractAttachmentStatus,
  ContractDocument,
  ContractItem,
} from './contract.schema';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { CounterService } from '../counter/counter.service';
import { OrderService } from '../order/order.service';
import { SessionRunner } from '../../common/db/session-runner';
import { SiteService } from '../site/site.service';
import { PhotosService } from '../photos/photos.service';

function contractUploadDir(): string {
  return resolve(process.env.UPLOAD_DIR ?? './uploads', 'contracts');
}

@Injectable()
export class ContractService {
  constructor(
    @InjectModel(Contract.name)
    private readonly model: Model<ContractDocument>,
    private readonly counter: CounterService,
    private readonly orderService: OrderService,
    private readonly sessionRunner: SessionRunner,
    private readonly sites: SiteService,
    private readonly photos: PhotosService,
  ) {}

  private resolveAttachmentState(
    contractStatus: CreateContractDto['contractStatus'] | undefined,
    attachmentFileId?: string,
    attachmentUrl?: string,
    fallback: ContractAttachmentStatus = 'none',
  ): {
    contractStatus: ContractAttachmentStatus;
    attachmentFileId?: string;
    attachmentUrl?: string;
  } {
    const fileId = attachmentFileId?.trim() || undefined;
    const url = attachmentUrl?.trim() || undefined;
    const hasReference = Boolean(fileId || url);
    const nextStatus = contractStatus ?? (hasReference ? 'file_attached' : fallback);

    if (nextStatus === 'file_attached' && !hasReference) {
      throw new BadRequestException(
        'contractStatus=file_attached requires attachmentFileId or attachmentUrl',
      );
    }
    if (nextStatus === 'none') return { contractStatus: 'none' };

    return {
      contractStatus: nextStatus,
      ...(fileId ? { attachmentFileId: fileId } : {}),
      ...(url ? { attachmentUrl: url } : {}),
    };
  }

  async create(dto: CreateContractDto): Promise<ContractDocument> {
    const number = dto.number ?? (await this.counter.next('Contract', 'CTR'));
    const items: ContractItem[] = dto.items.map((i) => ({
      productId: new Types.ObjectId(i.productId),
      productName: i.productName,
      quantity: i.quantity,
      unit: i.unit,
      unitPrice: i.unitPrice,
      total: (i.quantity ?? 0) * (i.unitPrice ?? 0),
    }));
    const totalAmount = items.reduce((s, i) => s + i.total, 0);
    const attachment = this.resolveAttachmentState(
      dto.contractStatus,
      dto.attachmentFileId,
      dto.attachmentUrl,
    );
    return this.model.create({
      number,
      title: dto.title,
      proposalId: dto.proposalId ? new Types.ObjectId(dto.proposalId) : undefined,
      organizationId: new Types.ObjectId(dto.organizationId),
      customerId: new Types.ObjectId(dto.customerId),
      status: dto.status ?? 'draft',
      ...attachment,
      items,
      notes: dto.notes,
      totalAmount,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      packageTag: dto.packageTag,
    });
  }

  async findAll(
    customerId?: string,
    status?: string,
    from?: Date,
    to?: Date,
  ): Promise<(Contract & { _id: Types.ObjectId })[]> {
    const filter: Record<string, unknown> = {};
    if (customerId) {
      if (!Types.ObjectId.isValid(customerId)) return [];
      filter.customerId = new Types.ObjectId(customerId);
    }
    if (status) filter.status = status;
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = from;
      if (to) range.$lte = to;
      filter.createdAt = range;
    }
    return this.model
      .find(filter)
      .populate('customerId')
      .populate('organizationId')
      .populate('proposalId')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async findById(id: string): Promise<ContractDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Contract ${id} not found`);
    }
    const doc = await this.model
      .findById(id)
      .populate('customerId')
      .populate('organizationId')
      .populate('proposalId')
      .exec();
    if (!doc) throw new NotFoundException(`Contract ${id} not found`);
    return doc;
  }

  /** Find by ID without populate — returns raw ObjectIds for refs. */
  private async findByIdRaw(id: string): Promise<ContractDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Contract ${id} not found`);
    }
    const doc = await this.model
      .findOne({ _id: new Types.ObjectId(id), deletedAt: null })
      .exec();
    if (!doc) throw new NotFoundException(`Contract ${id} not found`);
    return doc;
  }

  async attachFile(
    id: string,
    file: Express.Multer.File,
  ): Promise<ContractDocument> {
    if (!file || !file.buffer || file.size <= 0) {
      throw new BadRequestException('File is required and must not be empty');
    }

    const doc = await this.findByIdRaw(id);
    const previousFileId = doc.attachmentFileId;
    const directory = contractUploadDir();
    await fs.mkdir(directory, { recursive: true });

    const storedFilename = `${randomUUID()}${extname(file.originalname ?? '')}`;
    const storageUrl = `/uploads/contracts/${storedFilename}`;
    const fullPath = join(directory, storedFilename);
    await fs.writeFile(fullPath, file.buffer);

    let photoId: string | undefined;
    try {
      const photo = await this.photos.create({
        storageUrl,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        variant: 'original',
        alt: `Contract ${doc.number}`,
      });
      photoId = photo._id.toString();
      doc.contractStatus = 'file_attached';
      doc.attachmentFileId = photoId;
      doc.attachmentUrl = storageUrl;
      await doc.save();
    } catch (error) {
      if (photoId) {
        await this.discardAttachmentPhoto(photoId);
      } else {
        await this.unlinkAttachmentFile(fullPath);
      }
      throw error;
    }

    if (previousFileId && previousFileId !== photoId) {
      await this.discardAttachmentPhoto(previousFileId);
    }
    return doc;
  }

  async removeAttachment(id: string): Promise<ContractDocument> {
    const doc = await this.findByIdRaw(id);
    const previousFileId = doc.attachmentFileId;
    doc.contractStatus = 'none';
    doc.attachmentFileId = undefined;
    doc.attachmentUrl = undefined;
    await doc.save();
    if (previousFileId) await this.discardAttachmentPhoto(previousFileId);
    return doc;
  }

  private async discardAttachmentPhoto(photoId: string): Promise<void> {
    try {
      await this.photos.remove(photoId);
    } catch {
      // Attachment cleanup is best-effort after the Contract write succeeds.
    }
  }

  private async unlinkAttachmentFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch {
      // Best-effort rollback of a file written before the DB metadata.
    }
  }

  async update(id: string, dto: UpdateContractDto): Promise<ContractDocument> {
    const doc = await this.findById(id);
    if (dto.title !== undefined) doc.title = dto.title;
    if (dto.notes !== undefined) doc.notes = dto.notes;
    if (dto.status !== undefined) doc.status = dto.status;
    if (dto.expiresAt !== undefined) doc.expiresAt = new Date(dto.expiresAt);
    if (dto.packageTag !== undefined) doc.packageTag = dto.packageTag;
    if (
      dto.contractStatus !== undefined
      || dto.attachmentFileId !== undefined
      || dto.attachmentUrl !== undefined
    ) {
      const attachment = this.resolveAttachmentState(
        dto.contractStatus,
        dto.attachmentFileId,
        dto.attachmentUrl,
        doc.contractStatus ?? 'none',
      );
      doc.contractStatus = attachment.contractStatus;
      doc.attachmentFileId = attachment.attachmentFileId;
      doc.attachmentUrl = attachment.attachmentUrl;
    }
    if (dto.items !== undefined) {
      doc.items = dto.items.map((i) => ({
        productId: new Types.ObjectId(i.productId),
        productName: i.productName,
        quantity: i.quantity,
        unit: i.unit,
        unitPrice: i.unitPrice,
        total: (i.quantity ?? 0) * (i.unitPrice ?? 0),
      }));
      doc.totalAmount = doc.items.reduce((s, i) => s + i.total, 0);
    }
    return doc.save();
  }

  async sign(id: string, signedAt: string): Promise<ContractDocument> {
    const doc = await this.findById(id);
    doc.status = 'signed';
    doc.signedAt = new Date(signedAt);
    return doc.save();
  }

  async activate(id: string): Promise<{ contract: ContractDocument; orderId: string }> {
    return this.sessionRunner.run(async (session) => {
      const doc = await this.model.findById(id).session(session).exec();
      if (!doc) throw new NotFoundException(`Contract ${id} not found`);
      if (doc.status !== 'signed') {
        throw new NotFoundException(`Contract must be signed first (current: ${doc.status})`);
      }
      const site = await this.sites.ensureDefaultForCounterparty(doc.customerId.toString());
      const order = await this.orderService.create(
        {
          counterpartyId: doc.customerId.toString(),
          siteId: site._id.toString(),
          contractId: doc._id.toString(),
          status: 'confirmed',
          items: doc.items.map((i) => ({
            productId: i.productId.toString(),
            productName: i.productName,
            quantity: i.quantity,
            unit: i.unit,
            unitPrice: i.unitPrice,
          })),
        },
        session,
      );
      doc.status = 'active';
      await doc.save({ session });
      return { contract: doc, orderId: order._id.toString() };
    });
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
