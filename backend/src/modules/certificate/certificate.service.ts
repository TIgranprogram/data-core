import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Certificate, CertificateDocument } from './certificate.schema';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { UpdateCertificateDto } from './dto/update-certificate.dto';

@Injectable()
export class CertificateService {
  constructor(
    @InjectModel(Certificate.name)
    private readonly model: Model<CertificateDocument>,
  ) {}

  async create(dto: CreateCertificateDto): Promise<CertificateDocument> {
    return this.model.create({
      productIds: (dto.productIds ?? []).map((id) => new Types.ObjectId(id)),
      number: dto.number,
      certType: dto.certType,
      status: dto.status ?? 'active',
      issuedBy: dto.issuedBy,
      issueDate: new Date(dto.issueDate),
      expiresAt: new Date(dto.expiresAt),
      fileUrl: dto.fileUrl,
      notes: dto.notes,
    });
  }

  async findAll(productId?: string): Promise<CertificateDocument[]> {
    const filter: Record<string, unknown> = {};
    if (productId) {
      if (!Types.ObjectId.isValid(productId)) return [];
      filter.productIds = new Types.ObjectId(productId);
    }
    return this.model.find(filter).sort({ expiresAt: 1 }).exec();
  }

  /** Expiring within N days (default 30), status=active, expiry in future. */
  async findExpiring(days = 30): Promise<CertificateDocument[]> {
    const now = new Date();
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return this.model
      .find({
        status: 'active',
        expiresAt: { $gte: now, $lte: until },
      })
      .sort({ expiresAt: 1 })
      .exec();
  }

  async findById(id: string): Promise<CertificateDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Certificate ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`Certificate ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateCertificateDto): Promise<CertificateDocument> {
    const doc = await this.findById(id);
    if (dto.productIds !== undefined) {
      doc.productIds = dto.productIds.map((pid) => new Types.ObjectId(pid));
    }
    if (dto.number !== undefined) doc.number = dto.number;
    if (dto.certType !== undefined) doc.certType = dto.certType;
    if (dto.status !== undefined) doc.status = dto.status;
    if (dto.issuedBy !== undefined) doc.issuedBy = dto.issuedBy;
    if (dto.issueDate !== undefined) doc.issueDate = new Date(dto.issueDate);
    if (dto.expiresAt !== undefined) doc.expiresAt = new Date(dto.expiresAt);
    if (dto.fileUrl !== undefined) doc.fileUrl = dto.fileUrl;
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
