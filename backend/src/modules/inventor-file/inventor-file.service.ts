import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InventorFile, InventorFileDocument } from './inventor-file.schema';
import { CreateInventorFileDto } from './dto/create-inventor-file.dto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'inventor');

@Injectable()
export class InventorFileService {
  constructor(
    @InjectModel(InventorFile.name)
    private readonly model: Model<InventorFileDocument>,
  ) {}

  async saveUpload(
    productId: string,
    file: Express.Multer.File,
    dto: CreateInventorFileDto,
  ): Promise<InventorFileDocument> {
    if (!file) throw new NotFoundException('File is required');
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const ext = path.extname(file.originalname) || '';
    const stored = `${randomUUID()}${ext}`;
    const fullPath = path.join(UPLOAD_DIR, stored);
    await fs.writeFile(fullPath, file.buffer);
    const url = `/uploads/inventor/${stored}`;
    return this.model.create({
      productId: new Types.ObjectId(productId),
      productName: dto.productName,
      productSku: dto.productSku,
      fileName: file.originalname,
      fileType: dto.fileType ?? file.mimetype,
      sizeKb: Math.ceil(file.size / 1024),
      version: dto.version ?? 1,
      author: dto.author,
      url,
      description: dto.description,
      notes: dto.notes,
    });
  }

  async createMetadata(dto: CreateInventorFileDto): Promise<InventorFileDocument> {
    return this.model.create({
      ...dto,
      productId: new Types.ObjectId(dto.productId),
    });
  }

  async findAll(productId?: string): Promise<InventorFileDocument[]> {
    const filter: Record<string, unknown> = {};
    if (productId) {
      if (!Types.ObjectId.isValid(productId)) return [];
      filter.productId = new Types.ObjectId(productId);
    }
    return this.model.find(filter).sort({ productId: 1, version: -1 }).exec();
  }

  async findById(id: string): Promise<InventorFileDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`InventorFile ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`InventorFile ${id} not found`);
    return doc;
  }

  async getFilePath(id: string): Promise<{ doc: InventorFileDocument; absPath: string }> {
    const doc = await this.findById(id);
    const relPath = doc.url.replace(/^\/+/, '');
    const absPath = path.resolve(process.cwd(), relPath);
    return { doc, absPath };
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findById(id);
    try {
      const abs = path.resolve(process.cwd(), doc.url.replace(/^\/+/, ''));
      await fs.unlink(abs);
    } catch {
      // best-effort
    }
    await this.model.deleteOne({ _id: doc._id }).exec();
  }
}
