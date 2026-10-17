import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Invoice, InvoiceDocument } from './invoice.schema';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { MarkPaidDto } from './dto/mark-paid.dto';

@Injectable()
export class InvoiceService {
  constructor(
    @InjectModel(Invoice.name)
    private readonly model: Model<InvoiceDocument>,
  ) {}

  async create(dto: CreateInvoiceDto): Promise<InvoiceDocument> {
    return this.model.create({
      number: dto.number,
      type: dto.type ?? 'incoming',
      supplierId: new Types.ObjectId(dto.supplierId),
      purchaseOrderId: dto.purchaseOrderId
        ? new Types.ObjectId(dto.purchaseOrderId)
        : undefined,
      totalAmount: dto.totalAmount,
      invoiceDate: new Date(dto.invoiceDate),
      dueDate: new Date(dto.dueDate),
      status: 'received',
      paid: false,
      fileUrl: dto.fileUrl,
      notes: dto.notes,
    });
  }

  async findAll(
    supplierId?: string,
    status?: string,
    paid?: boolean,
    from?: Date,
    to?: Date,
  ): Promise<InvoiceDocument[]> {
    const filter: Record<string, unknown> = {};
    if (supplierId) {
      if (!Types.ObjectId.isValid(supplierId)) return [];
      filter.supplierId = new Types.ObjectId(supplierId);
    }
    if (status) filter.status = status;
    if (typeof paid === 'boolean') filter.paid = paid;
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = from;
      if (to) range.$lte = to;
      filter.invoiceDate = range;
    }
    return this.model
      .find(filter)
      .populate('supplierId')
      .populate('purchaseOrderId')
      .sort({ invoiceDate: -1 })
      .exec();
  }

  async findOverdue(): Promise<InvoiceDocument[]> {
    return this.model
      .find({ paid: false, dueDate: { $lt: new Date() }, status: { $ne: 'cancelled' } })
      .sort({ dueDate: 1 })
      .exec();
  }

  async findById(id: string): Promise<InvoiceDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`Invoice ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateInvoiceDto): Promise<InvoiceDocument> {
    const doc = await this.findById(id);
    if (dto.totalAmount !== undefined) doc.totalAmount = dto.totalAmount;
    if (dto.invoiceDate !== undefined) doc.invoiceDate = new Date(dto.invoiceDate);
    if (dto.dueDate !== undefined) doc.dueDate = new Date(dto.dueDate);
    if (dto.fileUrl !== undefined) doc.fileUrl = dto.fileUrl;
    if (dto.notes !== undefined) doc.notes = dto.notes;
    if (dto.status !== undefined) doc.status = dto.status;
    return doc.save();
  }

  async markPaid(id: string, dto: MarkPaidDto): Promise<InvoiceDocument> {
    const doc = await this.findById(id);
    doc.paid = true;
    doc.paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (dto.paidAmount !== undefined) doc.paidAmount = dto.paidAmount;
    else doc.paidAmount = doc.totalAmount;
    doc.status = 'paid';
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model
      .updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } })
      .exec();
  }
}
