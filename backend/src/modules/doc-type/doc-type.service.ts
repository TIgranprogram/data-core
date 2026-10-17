import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DocType, DocTypeDocument } from './doc-type.schema';
import { CreateDocTypeDto } from './dto/create-doc-type.dto';
import { UpdateDocTypeDto } from './dto/update-doc-type.dto';

const DEFAULT_DOCTYPES = [
  { name: 'КП', slug: 'proposal', description: 'Коммерческое предложение' },
  { name: 'Договор', slug: 'contract', description: 'Договор' },
  { name: 'Заказ', slug: 'order', description: 'Заказ' },
  { name: 'Счёт', slug: 'invoice', description: 'Счёт' },
  { name: 'Акт', slug: 'act', description: 'Акт выполненных работ' },
  { name: 'Отчёт', slug: 'report', description: 'Отчёт' },
];

@Injectable()
export class DocTypeService implements OnModuleInit {
  constructor(
    @InjectModel(DocType.name)
    private readonly model: Model<DocTypeDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const dt of DEFAULT_DOCTYPES) {
      await this.model.updateOne(
        { slug: dt.slug },
        { $setOnInsert: { ...dt, isActive: true } },
        { upsert: true },
      );
    }
  }

  async create(dto: CreateDocTypeDto): Promise<DocTypeDocument> {
    return this.model.create(dto);
  }

  async findAll(): Promise<DocTypeDocument[]> {
    return this.model.find().sort({ name: 1 }).exec();
  }

  async findById(id: string): Promise<DocTypeDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`DocType ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`DocType ${id} not found`);
    return doc;
  }

  async findBySlug(slug: string): Promise<DocTypeDocument | null> {
    return this.model.findOne({ slug }).exec();
  }

  async update(id: string, dto: UpdateDocTypeDto): Promise<DocTypeDocument> {
    const doc = await this.findById(id);
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.description !== undefined) doc.description = dto.description;
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model.deleteOne({ _id: doc._id }).exec();
  }
}
