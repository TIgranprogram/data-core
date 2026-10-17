import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ReconciliationAct, ReconciliationActDocument } from './reconciliation-act.schema';
import { CreateReconciliationActDto } from './dto/create-reconciliation-act.dto';
import { UpdateReconciliationActDto } from './dto/update-reconciliation-act.dto';
import { SignActDto } from './dto/sign-act.dto';
import { CounterService } from '../counter/counter.service';
import { Invoice, InvoiceDocument } from '../invoice/invoice.schema';
import { Counterparty, CounterpartyDocument } from '../counterparty/counterparty.schema';

@Injectable()
export class ReconciliationActService {
  constructor(
    @InjectModel(ReconciliationAct.name)
    private readonly model: Model<ReconciliationActDocument>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Counterparty.name)
    private readonly counterpartyModel: Model<CounterpartyDocument>,
    private readonly counter: CounterService,
  ) {}

  async create(dto: CreateReconciliationActDto): Promise<ReconciliationActDocument> {
    const number = dto.number ?? (await this.counter.next('ReconciliationAct', 'RA'));
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    const orgId = new Types.ObjectId(dto.organizationId);

    // Cache organizationName from Counterparty
    let organizationName = dto.organizationName;
    if (!organizationName) {
      const cp = await this.counterpartyModel.findById(orgId).exec();
      organizationName = cp?.name;
    }

    // Aggregate:
    //   totalDebit = sum of outgoing invoices (we issued; total pool — counterparty-specific
    //     filtering would require Invoice.customerId, not present in current schema)
    //   totalCredit = sum of incoming invoices from this counterparty
    //     (supplierId = them, type = 'incoming' = they issued to us)
    const [debitAgg] = await this.invoiceModel
      .aggregate([
        {
          $match: {
            type: 'outgoing',
            invoiceDate: { $gte: periodStart, $lte: periodEnd },
            status: { $ne: 'cancelled' },
          },
        },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ])
      .exec();
    const [creditAgg] = await this.invoiceModel
      .aggregate([
        {
          $match: {
            supplierId: orgId,
            type: 'incoming',
            invoiceDate: { $gte: periodStart, $lte: periodEnd },
            status: { $ne: 'cancelled' },
          },
        },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ])
      .exec();

    const totalDebit = debitAgg?.total ?? 0;
    const totalCredit = creditAgg?.total ?? 0;
    const balance = totalCredit - totalDebit;
    const ourDebt = Math.max(0, totalDebit - totalCredit);
    const theirDebt = Math.max(0, totalCredit - totalDebit);

    return this.model.create({
      number,
      organizationId: orgId,
      organizationName,
      periodStart,
      periodEnd,
      totalDebit,
      totalCredit,
      ourDebt,
      theirDebt,
      balance,
      status: 'draft',
      notes: dto.notes,
    });
  }

  async findAll(
    organizationId?: string,
    periodStart?: Date,
    periodEnd?: Date,
  ): Promise<ReconciliationActDocument[]> {
    const filter: Record<string, unknown> = {};
    if (organizationId) {
      if (!Types.ObjectId.isValid(organizationId)) return [];
      filter.organizationId = new Types.ObjectId(organizationId);
    }
    if (periodStart || periodEnd) {
      const range: Record<string, Date> = {};
      if (periodStart) range.$gte = periodStart;
      if (periodEnd) range.$lte = periodEnd;
      filter.periodStart = range;
    }
    return this.model.find(filter).populate('organizationId').sort({ periodStart: -1 }).exec();
  }

  async findById(id: string): Promise<ReconciliationActDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ReconciliationAct ${id} not found`);
    }
    const doc = await this.model.findById(id).populate('organizationId').exec();
    if (!doc) throw new NotFoundException(`ReconciliationAct ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateReconciliationActDto): Promise<ReconciliationActDocument> {
    const doc = await this.findById(id);
    if (dto.notes !== undefined) doc.notes = dto.notes;
    if (dto.organizationName !== undefined) doc.organizationName = dto.organizationName;
    return doc.save();
  }

  async sign(id: string, dto: SignActDto): Promise<ReconciliationActDocument> {
    const doc = await this.findById(id);
    doc.signDate = new Date(dto.signDate);
    if (dto.fileUrl !== undefined) doc.fileUrl = dto.fileUrl;
    doc.status = 'signed';
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } }).exec();
  }
}
