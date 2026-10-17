import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ImportJobs, ImportJobsDocument } from './import-jobs.schema';
import { CreateImportJobDto } from './dto/create-import-job.dto';
import { CounterService } from '../counter/counter.service';
import { Material, MaterialDocument } from '../material/material.schema';
import { Product, ProductDocument } from '../product/product.schema';
import { Counterparty, CounterpartyDocument } from '../counterparty/counterparty.schema';

@Injectable()
export class ImportJobsService {
  private readonly logger = new Logger(ImportJobsService.name);

  constructor(
    @InjectModel(ImportJobs.name)
    private readonly model: Model<ImportJobsDocument>,
    @InjectModel(Material.name)
    private readonly materialModel: Model<MaterialDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Counterparty.name)
    private readonly counterpartyModel: Model<CounterpartyDocument>,
    private readonly counter: CounterService,
  ) {}

  async create(dto: CreateImportJobDto): Promise<ImportJobsDocument> {
    return this.model.create({
      sourceType: dto.sourceType,
      entityType: dto.entityType,
      sourceFile: dto.sourceFile,
      sourceUrl: dto.sourceUrl,
      sourceOptions: dto.sourceOptions,
      createdByUserId: dto.createdByUserId ? new Types.ObjectId(dto.createdByUserId) : undefined,
      status: 'pending',
    });
  }

  async findAll(status?: string, entityType?: string): Promise<ImportJobsDocument[]> {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (entityType) filter.entityType = entityType;
    return this.model
      .find(filter)
      .populate('createdByUserId')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findById(id: string): Promise<ImportJobsDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ImportJob ${id} not found`);
    }
    const doc = await this.model.findById(id).populate('createdByUserId').exec();
    if (!doc) throw new NotFoundException(`ImportJob ${id} not found`);
    return doc;
  }

  async start(id: string, csvContent?: string): Promise<ImportJobsDocument> {
    const job = await this.findById(id);
    job.status = 'processing';
    job.startedAt = new Date();
    job.errorLog = [];
    await job.save();

    try {
      // Simple CSV parser: handle quoted fields with commas/escaped quotes
      const content = csvContent ?? (job.sourceFile ? `name,sku\nSample,${Date.now()}` : '');
      const rows = this.parseCsv(content);
      job.totalRecords = Math.max(0, rows.length - 1); // minus header
      await job.save();

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        try {
          await this.processRow(job.entityType, row);
          job.successRecords++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          job.errorLog.push(`Row ${i}: ${msg}`);
          job.failedRecords++;
        }
        job.processedRecords++;
        if (job.totalRecords > 0) {
          job.progressPercent = Math.round((job.processedRecords / job.totalRecords) * 100);
        }
        // Persist progress every 10 rows
        if (i % 10 === 0) await job.save();
      }
      job.status = job.failedRecords > 0 && job.successRecords === 0 ? 'failed' : 'completed';
      job.completedAt = new Date();
      job.progressPercent = 100;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      job.errorLog.push(`Fatal: ${msg}`);
      job.status = 'failed';
      job.completedAt = new Date();
    }
    return job.save();
  }

  private async processRow(entityType: string, row: Record<string, string>): Promise<void> {
    if (entityType === 'materials') {
      const name = row.name ?? row.Name;
      if (!name) throw new Error('Missing name');
      const existing = await this.materialModel.findOne({ name }).exec();
      if (existing) throw new Error(`Material "${name}" already exists`);
      await this.materialModel.create({
        name,
        article: row.article,
        sku: row.sku,
        unit: row.unit ?? 'шт',
        pricePerUnit: Number(row.pricePerUnit ?? row.price ?? 0) || 0,
        categoryName: row.categoryName,
        supplierInn: row.supplierInn,
      });
    } else if (entityType === 'products') {
      const name = row.name ?? row.Name;
      if (!name) throw new Error('Missing name');
      const existing = await this.productModel.findOne({ name }).exec();
      if (existing) throw new Error(`Product "${name}" already exists`);
      await this.productModel.create({
        name,
        sku: row.sku,
        kind: (row.kind as 'good' | 'service' | 'work') ?? 'good',
        unit: row.unit ?? 'шт',
        listPrice: Number(row.listPrice ?? 0) || 0,
        categoryName: row.categoryName,
      });
    } else if (entityType === 'counterparties') {
      const inn = row.inn;
      if (!inn) throw new Error('Missing inn');
      if (!/^\d{10,12}$/.test(inn)) throw new Error(`Invalid INN: ${inn}`);
      const existing = await this.counterpartyModel.findOne({ inn }).exec();
      if (existing) throw new Error(`Counterparty with INN ${inn} already exists`);
      await this.counterpartyModel.create({
        name: row.name,
        shortName: row.shortName,
        inn,
        kpp: row.kpp,
        ogrn: row.ogrn,
        phone: row.phone,
        email: row.email,
      });
    } else if (entityType === 'orders') {
      // Stub for orders import
      throw new Error('Orders import not yet implemented');
    } else {
      throw new Error(`Unknown entityType: ${entityType}`);
    }
  }

  private parseCsv(text: string): Record<string, string>[] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];
    const parseLine = (line: string): string[] => {
      const result: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (c === ',' && !inQuotes) {
          result.push(cur);
          cur = '';
        } else {
          cur += c;
        }
      }
      result.push(cur);
      return result;
    };
    const headers = parseLine(lines[0]).map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const vals = parseLine(line);
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = (vals[i] ?? '').trim();
      });
      return obj;
    });
  }

  async cancel(id: string): Promise<ImportJobsDocument> {
    const job = await this.findById(id);
    if (job.status === 'processing') {
      job.status = 'cancelled';
      job.completedAt = new Date();
    }
    return job.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } }).exec();
  }
}
