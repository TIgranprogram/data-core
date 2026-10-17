import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tender, TenderDocument } from './tender.schema';
import { CreateTenderDto } from './dto/create-tender.dto';
import { UpdateTenderDto } from './dto/update-tender.dto';
import { WinTenderDto } from './dto/win-tender.dto';

@Injectable()
export class TenderService {
  constructor(
    @InjectModel(Tender.name)
    private readonly model: Model<TenderDocument>,
  ) {}

  async create(dto: CreateTenderDto): Promise<TenderDocument> {
    return this.model.create({
      ...dto,
      companyId: dto.companyId ? new Types.ObjectId(dto.companyId) : undefined,
      customerOrgId: dto.customerOrgId
        ? new Types.ObjectId(dto.customerOrgId)
        : undefined,
      publishDate: dto.publishDate ? new Date(dto.publishDate) : undefined,
      submissionDeadline: dto.submissionDeadline
        ? new Date(dto.submissionDeadline)
        : undefined,
      resultDate: dto.resultDate ? new Date(dto.resultDate) : undefined,
      status: 'open',
      isActive: true,
    });
  }

  async findAll(status?: string): Promise<TenderDocument[]> {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    return this.model.find(filter).sort({ submissionDeadline: 1 }).exec();
  }

  async findExpiring(days = 7): Promise<TenderDocument[]> {
    const now = new Date();
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return this.model
      .find({
        submissionDeadline: { $gte: now, $lte: until },
        status: { $in: ['open', 'draft'] },
      })
      .sort({ submissionDeadline: 1 })
      .exec();
  }

  async findById(id: string): Promise<TenderDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Tender ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`Tender ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateTenderDto): Promise<TenderDocument> {
    const doc = await this.findById(id);
    Object.assign(doc, dto);
    if (dto.publishDate !== undefined) doc.publishDate = new Date(dto.publishDate);
    if (dto.submissionDeadline !== undefined) {
      doc.submissionDeadline = new Date(dto.submissionDeadline);
    }
    if (dto.resultDate !== undefined) doc.resultDate = new Date(dto.resultDate);
    return doc.save();
  }

  async attachQuote(id: string, quoteId: string): Promise<TenderDocument> {
    const doc = await this.findById(id);
    if (!Types.ObjectId.isValid(quoteId)) {
      throw new NotFoundException(`Invalid quoteId ${quoteId}`);
    }
    const qid = new Types.ObjectId(quoteId);
    if (!doc.quoteIds.some((q) => q.toString() === qid.toString())) {
      doc.quoteIds.push(qid);
    }
    doc.status = 'submitted';
    return doc.save();
  }

  async win(id: string, dto: WinTenderDto): Promise<TenderDocument> {
    const doc = await this.findById(id);
    doc.status = 'won';
    doc.ourPrice = dto.ourPrice;
    doc.resultDate = dto.resultDate ? new Date(dto.resultDate) : new Date();
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
