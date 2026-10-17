import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FinancialReport, FinancialReportDocument } from './financial-report.schema';
import { GenerateFinancialReportDto } from './dto/generate-financial-report.dto';
import { UpdateFinancialReportDto } from './dto/update-financial-report.dto';
import { CounterService } from '../counter/counter.service';
import { Invoice, InvoiceDocument } from '../invoice/invoice.schema';
import { ActualCost, ActualCostDocument } from '../actual-cost/actual-cost.schema';
import { PurchaseOrder, PurchaseOrderDocument } from '../purchase-order/purchase-order.schema';

@Injectable()
export class FinancialReportService {
  constructor(
    @InjectModel(FinancialReport.name)
    private readonly model: Model<FinancialReportDocument>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(ActualCost.name)
    private readonly actualCostModel: Model<ActualCostDocument>,
    @InjectModel(PurchaseOrder.name)
    private readonly poModel: Model<PurchaseOrderDocument>,
    private readonly counter: CounterService,
  ) {}

  async generate(dto: GenerateFinancialReportDto): Promise<FinancialReportDocument> {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);

    // totalIncome = sum of paid invoices (incoming revenue)
    const [incomeAgg] = await this.invoiceModel
      .aggregate([
        {
          $match: {
            status: 'paid',
            paidAt: { $gte: periodStart, $lte: periodEnd },
          },
        },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ])
      .exec();

    // totalExpense = sum of actual costs + purchase orders
    const [acAgg] = await this.actualCostModel
      .aggregate([
        {
          $match: { date: { $gte: periodStart, $lte: periodEnd } },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ])
      .exec();
    const [poAgg] = await this.poModel
      .aggregate([
        {
          $match: { createdAt: { $gte: periodStart, $lte: periodEnd }, status: { $ne: 'cancelled' } },
        },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ])
      .exec();

    const totalIncome = incomeAgg?.total ?? 0;
    const totalExpense = (acAgg?.total ?? 0) + (poAgg?.total ?? 0);
    const netProfit = totalIncome - totalExpense;

    // Breakdown by month
    const monthly = await this.invoiceModel
      .aggregate([
        {
          $match: { paidAt: { $gte: periodStart, $lte: periodEnd }, status: 'paid' },
        },
        {
          $group: {
            _id: { y: { $year: '$paidAt' }, m: { $month: '$paidAt' } },
            income: { $sum: '$totalAmount' },
          },
        },
        { $sort: { '_id.y': 1, '_id.m': 1 } },
      ])
      .exec();

    const data = {
      monthly,
      summary: { totalIncome, totalExpense, netProfit },
    };

    const number = await this.counter.next('FinancialReport', 'FR');
    return this.model.create({
      number,
      title: dto.title ?? `${dto.reportType} ${dto.periodStart} - ${dto.periodEnd}`,
      reportType: dto.reportType,
      periodStart,
      periodEnd,
      data,
      totalAmount: totalIncome,
      totalIncome,
      totalExpense,
      netProfit,
      status: 'generated',
      generatedAt: new Date(),
      notes: dto.notes,
    });
  }

  async findAll(
    reportType?: string,
    periodStart?: Date,
    periodEnd?: Date,
  ): Promise<FinancialReportDocument[]> {
    const filter: Record<string, unknown> = {};
    if (reportType) filter.reportType = reportType;
    if (periodStart || periodEnd) {
      const range: Record<string, Date> = {};
      if (periodStart) range.$gte = periodStart;
      if (periodEnd) range.$lte = periodEnd;
      filter.periodStart = range;
    }
    return this.model.find(filter).sort({ periodStart: -1 }).exec();
  }

  async findById(id: string): Promise<FinancialReportDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`FinancialReport ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`FinancialReport ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateFinancialReportDto): Promise<FinancialReportDocument> {
    const doc = await this.findById(id);
    if (dto.title !== undefined) doc.title = dto.title;
    if (dto.notes !== undefined) doc.notes = dto.notes;
    if (dto.status !== undefined) doc.status = dto.status;
    return doc.save();
  }

  async export(id: string, format: 'pdf' | 'xlsx'): Promise<{ format: string; message: string }> {
    const doc = await this.findById(id);
    doc.status = 'exported';
    await doc.save();
    // PDF/XLSX export not implemented in TZ-15
    return {
      format,
      message: `Export of ${doc.number} as ${format} requested; rendering pipeline not yet implemented (HTML preview available via DocumentTemplate)`,
    };
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } }).exec();
  }
}
