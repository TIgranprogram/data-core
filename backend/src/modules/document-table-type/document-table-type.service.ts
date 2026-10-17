import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DocumentTableType, DocumentTableTypeDocument } from './document-table-type.schema';
import { CreateDocumentTableTypeDto } from './dto/create-document-table-type.dto';
import { UpdateDocumentTableTypeDto } from './dto/update-document-table-type.dto';

@Injectable()
export class DocumentTableTypeService {
  constructor(
    @InjectModel(DocumentTableType.name)
    private readonly model: Model<DocumentTableTypeDocument>,
  ) {}

  async create(dto: CreateDocumentTableTypeDto): Promise<DocumentTableTypeDocument> {
    return this.model.create({
      name: dto.name,
      label: dto.label,
      title: dto.title,
      docType: dto.docType ? new Types.ObjectId(dto.docType) : undefined,
      columns: dto.columns,
      dataSource: dto.dataSource,
      productKind: dto.productKind,
      sortOrder: dto.sortOrder ?? 0,
      fontSize: dto.fontSize ?? 12,
      isActive: dto.isActive ?? true,
    });
  }

  async findAll(): Promise<DocumentTableTypeDocument[]> {
    return this.model.find().sort({ sortOrder: 1, name: 1 }).exec();
  }

  async findById(id: string): Promise<DocumentTableTypeDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`DocumentTableType ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`DocumentTableType ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateDocumentTableTypeDto): Promise<DocumentTableTypeDocument> {
    const doc = await this.findById(id);
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.label !== undefined) doc.label = dto.label;
    if (dto.title !== undefined) doc.title = dto.title;
    if (dto.docType !== undefined) {
      doc.docType = dto.docType ? new Types.ObjectId(dto.docType) : (undefined as unknown as Types.ObjectId);
    }
    if (dto.columns !== undefined) doc.columns = dto.columns as never;
    if (dto.dataSource !== undefined) doc.dataSource = dto.dataSource;
    if (dto.productKind !== undefined) doc.productKind = dto.productKind;
    if (dto.sortOrder !== undefined) doc.sortOrder = dto.sortOrder;
    if (dto.fontSize !== undefined) doc.fontSize = dto.fontSize;
    if (dto.isActive !== undefined) doc.isActive = dto.isActive;
    return doc.save();
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    await this.model.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date(), isActive: false } }).exec();
  }
}
